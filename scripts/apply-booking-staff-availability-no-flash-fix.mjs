import fs from 'node:fs';
import path from 'node:path';

const filePath = path.join(process.cwd(), 'src/pages/Booking.tsx');
const raw = fs.readFileSync(filePath, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let source = raw.replace(/\r\n/g, '\n');

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`[booking-no-flash] expected source not found: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`[booking-no-flash] source matched more than once: ${label}`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
`  const [staffFullDayByItem, setStaffFullDayByItem] = useState<
    Record<string, Record<string, boolean>>
  >({});`,
`  const [staffFullDayByItem, setStaffFullDayByItem] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [staffFullDayResolvedKeyByItem, setStaffFullDayResolvedKeyByItem] = useState<
    Record<string, string>
  >({});`,
'add resolved-context state'
);

replaceOnce(
`    if (currentStep !== 2) {
      setStaffFullDayByItem({});
      return;
    }`,
`    if (currentStep !== 2) {
      setStaffFullDayByItem({});
      setStaffFullDayResolvedKeyByItem({});
      return;
    }`,
'clear resolved context outside appointment step'
);

replaceOnce(
`      if (!items.length) {
        if (!cancelled) setStaffFullDayByItem({});
        return;
      }

      const nextState: Record<string, Record<string, boolean>> = {};
      const availabilityCache = new Map<string, Promise<boolean>>();`,
`      if (!items.length) {
        if (!cancelled) {
          setStaffFullDayByItem({});
          setStaffFullDayResolvedKeyByItem({});
        }
        return;
      }

      const nextState: Record<string, Record<string, boolean>> = {};
      const nextResolvedKeys: Record<string, string> = {};
      const availabilityCache = new Map<string, Promise<boolean>>();`,
'prepare resolved context map'
);

replaceOnce(
`        const serviceKey =
          resolveCanonicalServiceId(
            String(it.serviceId || "").trim(),
            String((it as any)?.serviceName || "").trim()
          ) || String(it.serviceId || "").trim();
        if (!serviceKey) continue;

        const serviceStaff = (staffByService[serviceKey] || []) as StaffPublicWithId[];
        if (!serviceStaff.length) continue;`,
`        const serviceKey =
          resolveCanonicalServiceId(
            String(it.serviceId || "").trim(),
            String((it as any)?.serviceName || "").trim()
          ) || String(it.serviceId || "").trim();
        if (!serviceKey) continue;

        const serviceStaff = (staffByService[serviceKey] || []) as StaffPublicWithId[];
        const staffFingerprint = serviceStaff
          .map((st) => String((st as any)?.id || "").trim())
          .filter(Boolean)
          .sort()
          .join(",");
        nextResolvedKeys[itemId] = [
          dateISO,
          serviceKey,
          String(Math.max(1, Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN))),
          staffFingerprint,
        ].join("__");
        nextState[itemId] = nextState[itemId] || {};
        if (!serviceStaff.length) continue;`,
'bind availability result to date service duration and staff roster'
);

replaceOnce(
`      setStaffFullDayByItem(nextState);
    }

    const t = window.setTimeout(() => {
      if (cancelled) return;
      void loadStaffFullDayState();
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };`,
`      setStaffFullDayByItem(nextState);
      setStaffFullDayResolvedKeyByItem(nextResolvedKeys);
    }

    void loadStaffFullDayState();
    return () => {
      cancelled = true;
    };`,
'remove delayed availability fetch and publish resolved context'
);

replaceOnce(
`                          const coreUnavailableForItem = staffFullDayByItem[it.id] || {};
                          const staffChoicesForItem = availableStaff.filter((staff: any) => {
                            const id = String(staff?.id || "").trim();
                            return !id || !coreUnavailableForItem[id];
                          });
                          const staffLoading = !!staffLoadingByService[serviceKeyForStaff];`,
`                          const coreUnavailableForItem = staffFullDayByItem[it.id] || {};
                          const staffFingerprintForItem = serviceStaff
                            .map((staff: any) => String(staff?.id || "").trim())
                            .filter(Boolean)
                            .sort()
                            .join(",");
                          const coreAvailabilityKeyForItem = [
                            dateISO,
                            serviceKeyForStaff,
                            String(Math.max(1, Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN))),
                            staffFingerprintForItem,
                          ].join("__");
                          const coreAvailabilityLoading =
                            staffFullDayResolvedKeyByItem[it.id] !== coreAvailabilityKeyForItem;
                          const staffChoicesForItem = coreAvailabilityLoading
                            ? []
                            : availableStaff.filter((staff: any) => {
                                const id = String(staff?.id || "").trim();
                                return !id || !coreUnavailableForItem[id];
                              });
                          const staffLoading =
                            !!staffLoadingByService[serviceKeyForStaff] || coreAvailabilityLoading;`,
'hold staff cards until Core availability resolves for current context'
);

const next = eol === '\r\n' ? source.replace(/\n/g, '\r\n') : source;
if (next === raw) {
  console.log('[booking-no-flash] Booking.tsx already up to date.');
} else {
  fs.writeFileSync(filePath, next, 'utf8');
  console.log('[booking-no-flash] Booking.tsx updated successfully.');
}
