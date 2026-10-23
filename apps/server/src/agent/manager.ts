// Created by The Angelo Umali.
// One live agent session per project (plan §6.12): start on the first prompt, resume from agent_sessions, auto-resume one crash.
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { StudioDatabase } from "@zks/db";
import { loadAgentCredential, type AgentCredential } from "../auth/connection-store.ts";
import { agentConfigDir, buildAgentEnv, ensureAgentConfigDir } from "../auth/agent-env.ts";
import type { SecretStore } from "../auth/secret-store.ts";
import { readSettings } from "../auth/settings-store.ts";
import { projectDir } from "../config.ts";
import type { ProjectRow } from "../dto.ts";
import { HttpError } from "../http/http-error.ts";
import type { Logger } from "../logging/logger.ts";
import { assertNever } from "./assert-never.ts";
import type { DecisionBroker, DecisionRequest } from "./decisions.ts";
import type { QueryFunction } from "./query-function.ts";
import { buildQueryOptions, type SessionLimits } from "./query-options.ts";
import { findResumeSessionId, SDK_AUTH_MODES, SessionRecorder } from "./session-records.ts";
import { createAgentSession, type AgentSession, type AgentSessionOptions, type SessionOutcome } from "./session.ts";

const MAX_AUTO_RESUMES = 1;
const CRASH_MESSAGE = "Claude stopped unexpectedly. Send a message to try again.";
/** What init must report: the key from env in mode A, none in mode B (cloud credentials are not API keys). */
const API_KEY_SOURCES: Readonly<Record<AgentCredential["kind"], string>> = { apiKey: "ANTHROPIC_API_KEY", cloud: "none" };

export interface AgentManagerDeps {
  readonly database: StudioDatabase;
  readonly secretStore: SecretStore;
  readonly logger: Logger;
  readonly studioHome: string;
  readonly appVersion: string;
  readonly pluginDir: string;
  readonly requiredSkills: readonly string[];
  /** The SDK's query, or the `-p` runner when the SDK binary is missing. */
  readonly query: QueryFunction;
  readonly broker: DecisionBroker;
  readonly limits: SessionLimits;
  /** null on the `-p` path, whose child reaches the studio tools through the HTTP twin instead. */
  readonly studioMcpServer: ((project: ProjectRow) => McpServerConfig) | null;
  readonly cancelProjectJobs: (projectId: string) => Promise<void>;
  readonly initTimeoutMs?: number;
}

interface LiveSession {
  readonly project: ProjectRow;
  readonly session: AgentSession;
  readonly recorder: SessionRecorder;
  readonly attempt: number;
}

type SessionEntry = Promise<LiveSession>;

interface StartRequest {
  readonly attempt: number;
  readonly resume?: string;
}

export class AgentManager {
  readonly #deps: AgentManagerDeps;
  /** Promises, so two prompts racing in before the first start finishes share one child. */
  readonly #sessions = new Map<string, SessionEntry>();

  constructor(deps: AgentManagerDeps) {
    this.#deps = deps;
  }

  async submit(project: ProjectRow, text: string): Promise<void> {
    const live = await this.#liveSession(project);
    live.session.submit(text);
  }

  decide(projectId: string, decision: DecisionRequest): boolean {
    return this.#deps.broker.settle(projectId, decision);
  }

  async stop(projectId: string): Promise<void> {
    const entry = this.#sessions.get(projectId);
    if (entry !== undefined) return (await entry).session.stop();
    // Jobs outlive a session; Stop still cancels them.
    this.#deps.broker.cancelProject(projectId);
    await this.#deps.cancelProjectJobs(projectId);
  }

  async kill(projectId: string): Promise<void> {
    const entry = this.#sessions.get(projectId);
    this.#sessions.delete(projectId);
    (await entry)?.session.kill();
  }

  /** For onConnectionChanged: the next prompt starts a child with the new credential. */
  closeAll(): void {
    const entries = [...this.#sessions.values()];
    this.#sessions.clear();
    // A failed start already answered the prompt that triggered it.
    for (const entry of entries)
      void entry.then(
        (live) => live.session.kill(),
        () => undefined,
      );
  }

  #liveSession(project: ProjectRow): SessionEntry {
    const existing = this.#sessions.get(project.id);
    if (existing !== undefined) return existing;
    const starting = this.#start(project, { attempt: 0 });
    this.#track(project.id, starting);
    return starting;
  }

  #track(projectId: string, entry: SessionEntry): void {
    this.#sessions.set(projectId, entry);
    void entry.then(
      (live) => this.#watch(entry, live),
      () => this.#forget(projectId, entry),
    );
  }

  #watch(entry: SessionEntry, live: LiveSession): void {
    void live.session.done
      .then((outcome) => this.#onOutcome({ entry, live, outcome }))
      .catch((error: unknown) => this.#deps.logger.error("agent session cleanup failed", { projectId: live.project.id, error }));
  }

  /** True when the entry was still the project's current session. */
  #forget(projectId: string, entry: SessionEntry): boolean {
    if (this.#sessions.get(projectId) !== entry) return false;
    this.#sessions.delete(projectId);
    return true;
  }

  async #onOutcome(ended: { entry: SessionEntry; live: LiveSession; outcome: SessionOutcome }): Promise<void> {
    const { live, outcome } = ended;
    const wasCurrent = this.#forget(live.project.id, ended.entry);
    switch (outcome.kind) {
      case "ended":
        return;
      case "killed":
        return live.recorder.markStatus("interrupted");
      case "failed":
        return live.recorder.markStatus("errored");
      case "crashed":
        return this.#onCrash({ live, wasCurrent, sdkSessionId: outcome.sdkSessionId });
      default:
        return assertNever(outcome);
    }
  }

  async #onCrash(crash: { live: LiveSession; wasCurrent: boolean; sdkSessionId: string }): Promise<void> {
    const { live } = crash;
    if (crash.wasCurrent && live.attempt < MAX_AUTO_RESUMES) {
      const restarted = this.#start(live.project, { attempt: live.attempt + 1, resume: crash.sdkSessionId });
      this.#track(live.project.id, restarted);
      if (
        await restarted.then(
          () => true,
          () => false,
        )
      )
        return;
    }
    await live.recorder.markStatus("errored");
    await this.#deps.broker.publish({ type: "session.error", projectId: live.project.id, kind: "unknown", message: CRASH_MESSAGE });
  }

  async #start(project: ProjectRow, request: StartRequest): Promise<LiveSession> {
    const { database, secretStore, studioHome } = this.#deps;
    const credential = await loadAgentCredential(database, secretStore);
    if (credential === null) throw new HttpError(409, "Connect Claude before sending a prompt");
    const [settings, resume] = await Promise.all([readSettings(database), request.resume ?? findResumeSessionId(database, project.id, SDK_AUTH_MODES)]);
    await ensureAgentConfigDir(agentConfigDir(studioHome));
    const recorder = new SessionRecorder({ database, projectId: project.id, credential });
    const env = buildAgentEnv(credential, { studioHome, appVersion: this.#deps.appVersion, proxyOptIn: settings.proxyOptIn });
    const options = this.#sessionOptions({ project, credential, env, recorder });
    const session = createAgentSession({ ...options, ...(resume === undefined ? {} : { resume }) });
    return { project, session, recorder, attempt: request.attempt };
  }

  #sessionOptions(start: { project: ProjectRow; credential: AgentCredential; env: Record<string, string>; recorder: SessionRecorder }): AgentSessionOptions {
    const { project, credential } = start;
    const deps = this.#deps;
    return {
      projectId: project.id,
      query: deps.query,
      queryOptions: buildQueryOptions({
        projectId: project.id,
        projectDir: projectDir(deps.studioHome, project.slug),
        pluginDir: deps.pluginDir,
        credential,
        env: start.env,
        broker: deps.broker,
        limits: deps.limits,
        studioMcpServer: deps.studioMcpServer?.(project) ?? null,
      }),
      publish: deps.broker.publish,
      broker: deps.broker,
      expectations: { requiredSkills: deps.requiredSkills, apiKeySource: API_KEY_SOURCES[credential.kind] },
      cancelProjectJobs: deps.cancelProjectJobs,
      onMessage: (message) => start.recorder.record(message),
      ...(deps.initTimeoutMs === undefined ? {} : { initTimeoutMs: deps.initTimeoutMs }),
    };
  }
}
