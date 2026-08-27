import { WorkerEntrypoint } from "cloudflare:workers";

import coreWorker from "./index.js";
import {
  resolvePartnerOperationalDays,
} from "./repositories/partner-operational-days.js";

// Capability-scoped Worker-to-Worker API.
// It exposes only Partner Portal operational-day reads.
// It does not expose generic HR administration.
export class PartnerSchedulingEntrypoint extends WorkerEntrypoint {
  async resolveOperationalDays(input = {}) {
    return resolvePartnerOperationalDays(
      this.env.CORE_DB,
      this.env.SALON_ID || "main",
      input
    );
  }
}

// Keep the existing HTTP + scheduled Core worker behavior unchanged.
export default coreWorker;
