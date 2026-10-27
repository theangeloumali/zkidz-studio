// Created by The Angelo Umali.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleX, Database } from "lucide-react";
import { useId } from "react";
import { fetchDoctorChecks, type DoctorCheck } from "../api/agent-client.ts";
import { doctorQuery } from "../api/queries.ts";
import { buttonClass } from "../components/button-class.ts";

const STATUS_VIEW = {
  pass: { Icon: CircleCheck, word: "OK", tone: "text-success" },
  warn: { Icon: CircleAlert, word: "Check", tone: "text-copy" },
  fail: { Icon: CircleX, word: "Missing", tone: "text-danger" },
} as const;
const DATABASE_CHECK_ID = "database";

function StatusCell({ status, failWord }: { readonly status: DoctorCheck["status"]; readonly failWord?: string }) {
  const { Icon, word, tone } = STATUS_VIEW[status];
  return (
    <td className="py-3 pr-4 align-top">
      <span className={`inline-flex items-center gap-1.5 text-ui font-semibold ${tone}`}>
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {status === "fail" && failWord ? failWord : word}
      </span>
    </td>
  );
}

function CheckRow({ check }: { readonly check: DoctorCheck }) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <th scope="row" className="py-3 pr-4 text-left align-top text-ui font-semibold text-copy">
        {check.label}
      </th>
      <StatusCell status={check.status} />
      <td className="py-3 align-top text-ui text-copy-muted">
        <span className="break-words">{check.detail}</span>
        {check.fix ? <span className="block text-copy">Fix: {check.fix}</span> : null}
      </td>
    </tr>
  );
}

/** Read-only by design: the backend is chosen by DATABASE_URL at launch, never from the browser. Names none until checked. */
function DatabaseRow({ check }: { readonly check: DoctorCheck | undefined }) {
  return (
    <tr>
      <th scope="row" className="py-3 pr-4 text-left align-top text-ui font-semibold text-copy">
        {check?.label ?? "Data backend"}
      </th>
      {check ? (
        // A Postgres that runs but is unsafe is not missing: the row's fail cases are all settings to fix.
        <StatusCell status={check.status} failWord="Fix needed" />
      ) : (
        <td className="py-3 pr-4 align-top">
          <Database aria-hidden="true" className="size-4 text-copy-muted" />
        </td>
      )}
      <td className="py-3 align-top text-ui text-copy-muted">
        <span className="block text-copy">{check ? `${check.detail} · ` : ""}switch in README (DATABASE_URL)</span>
        {check?.fix ? <span className="block text-copy">Fix: {check.fix}</span> : null}
        Footage and renders always stay as files in your project folder.
      </td>
    </tr>
  );
}

export function DoctorPanel() {
  const headingId = useId();
  const checks = useQuery(doctorQuery());
  const queryClient = useQueryClient();
  const rerun = useMutation({
    mutationFn: () => fetchDoctorChecks({ refresh: true }),
    onSuccess: (fresh) => queryClient.setQueryData(doctorQuery().queryKey, fresh),
  });
  const isRunning = checks.isFetching || rerun.isPending;
  const machineChecks = checks.data?.filter((check) => check.id !== DATABASE_CHECK_ID) ?? [];
  const databaseCheck = checks.data?.find((check) => check.id === DATABASE_CHECK_ID);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-card border border-line bg-bg-elevated p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-panel-title font-semibold text-copy">
          This computer
        </h2>
        <button type="button" className={buttonClass("quiet")} onClick={() => rerun.mutate()} disabled={isRunning}>
          Run checks again
        </button>
      </div>
      {checks.isError || rerun.isError ? (
        <p role="alert" className="text-ui text-danger">
          The checks could not run: {(rerun.error ?? checks.error)?.message}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table aria-labelledby={headingId} aria-busy={isRunning} className="w-full min-w-[32rem] border-collapse">
          <thead className="sr-only">
            <tr>
              <th scope="col">Check</th>
              <th scope="col">Status</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {machineChecks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
            <DatabaseRow check={databaseCheck} />
          </tbody>
        </table>
      </div>
    </section>
  );
}
