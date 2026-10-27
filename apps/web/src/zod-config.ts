// Created by The Angelo Umali.
// Imported first by main.tsx: the CSP forbids eval, and zod's first parse probes for it with new Function, logging a
// violation. A module of its own, as main.tsx's body runs only after every module it imports.
import { z } from "zod";

z.config({ jitless: true });
