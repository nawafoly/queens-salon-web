import { collection, doc } from "firebase/firestore";

import { db } from "./firebase";

export const PARTNER_SALON_ID = "main" as const;

export const PARTNER_COLLECTIONS = {
  partners: "partners",
  rentalResources: "rental_resources",
  partnerContracts: "partner_contracts",
  partnerMembers: "partner_members",
} as const;

export type PartnerCollectionKey = keyof typeof PARTNER_COLLECTIONS;

export function partnerCollection(
  key: PartnerCollectionKey,
  salonId: string = PARTNER_SALON_ID
) {
  return collection(
    db,
    "salons",
    String(salonId || PARTNER_SALON_ID).trim() || PARTNER_SALON_ID,
    PARTNER_COLLECTIONS[key]
  );
}

export function partnerDoc(
  key: PartnerCollectionKey,
  id: string,
  salonId: string = PARTNER_SALON_ID
) {
  return doc(
    db,
    "salons",
    String(salonId || PARTNER_SALON_ID).trim() || PARTNER_SALON_ID,
    PARTNER_COLLECTIONS[key],
    String(id || "").trim()
  );
}
