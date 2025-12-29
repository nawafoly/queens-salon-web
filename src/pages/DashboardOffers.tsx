// src/pages/DashboardOffers.tsx
import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faTrash,
  faTag,
} from "@fortawesome/free-solid-svg-icons";



// ✅ CSS
import "../styles/DashboardModals.css";
import "../styles/DashboardOffers.css";

// ✅ Firestore
import {
  listOffers,
  upsertOffer,
  removeOffer,
} from "../services/firestoreOffers";
import type {
  Offer,
  DiscountType,
  OfferAppliesTo,
} from "../services/firestoreOffers";

type OfferForm = {
  title: string;
  code: string;
  discountType: DiscountType;
  value: number;
  startDate: string;
  endDate: string;
  active: boolean;
  imageUrl?: string;
  appliesTo: OfferAppliesTo;
  serviceIds: string[];
};


const SALON_ID = "main";

function generateCode(prefix = "QS") {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const time = Date.now().toString().slice(-4);
  return `${prefix}-${rand}${time}`;
}

function makeOfferId() {
  const anyCrypto: any = globalThis.crypto as any;
  if (anyCrypto?.randomUUID) return `O-${anyCrypto.randomUUID()}`;
  return `O-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}







const DashboardOffers: FC = () => {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Offer | null>(null);



  const [form, setForm] = useState<OfferForm>({
    title: "",
    code: "",
    discountType: "fixed",
    value: 0,
    startDate: "",
    endDate: "",
    active: true,
    imageUrl: "",
    appliesTo: "all",
    serviceIds: [],
  });









  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);







  const refresh = async () => {
    const data = await listOffers(SALON_ID);
    setOffers(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    refresh();
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({
      title: "",
      code: generateCode(),
      discountType: "fixed",
      value: 0,
      startDate: "",
      endDate: "",
      active: true,
      imageUrl: "",
      appliesTo: "all",
      serviceIds: [],
    });
    setOpen(true);
  };

  const save = async () => {
    const id = editing?.id || makeOfferId();
    await upsertOffer(
      {
        id,
        ...form,
        value: Number(form.value),
      } as Offer,
      SALON_ID
    );
    await refresh();
    setOpen(false);
  };

  const remove = async (o: Offer) => {
    if (!confirm("حذف العرض؟")) return;
    await removeOffer(o.id, SALON_ID);
    await refresh();
  };



  return (
    <div className="dashboard-skin offers-page">
      <h1>
        <FontAwesomeIcon icon={faTag} /> العروض
      </h1>

      <button onClick={openAdd}>
        <FontAwesomeIcon icon={faPlus} /> إضافة عرض
      </button>

      <table>
        <tbody>
          {offers.map((o) => (
            <tr key={o.id}>
              <td>{o.title}</td>
              <td>{o.code}</td>
              <td>
                <button onClick={() => remove(o)}>
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {open && (
        <div className="dash-modal-overlay" onClick={() => setOpen(false)}>
          <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
            <input
              value={form.title}
              onChange={(e) =>
                setForm((p) => ({ ...p, title: e.target.value }))
              }
            />
            <input
              value={form.code}
              onChange={(e) =>
                setForm((p) => ({ ...p, code: e.target.value }))
              }
            />
            <button onClick={save}>حفظ</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardOffers;
