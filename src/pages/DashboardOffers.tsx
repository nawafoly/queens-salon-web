// src/pages/DashboardOffers.tsx
import { Fragment, useEffect, useMemo, useRef, useState, type FC } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faTrash,
  faPen,
  faBan,
  faTag,
  faXmark,
  faWandMagicSparkles,
  faImage,
  faMagnifyingGlass,
  faCheck,
} from "@fortawesome/free-solid-svg-icons";

import { pricingSections } from "./Pricing";

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

const MAX_IMAGE_MB = 2;
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

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function extractMinPrice(priceText: string): number {
  const cleaned = String(priceText || "").replace(/[^\d\-]/g, "");
  if (!cleaned) return 0;

  const parts = cleaned
    .split("-")
    .filter(Boolean)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));

  if (!parts.length) return 0;
  return Math.min(...parts);
}

type FlatService = {
  id: string;
  sectionId: string;
  sectionTitle: string;
  category: string;
  name: string;
  basePrice: number;
};

const DashboardOffers: FC = () => {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Offer | null>(null);

  const [query, setQuery] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [pickedImageName, setPickedImageName] = useState("");

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

  const [discountOpen, setDiscountOpen] = useState(false);
  const discountWrapRef = useRef<HTMLDivElement | null>(null);

  const discountOptions = useMemo(
    () => [
      { value: "fixed" as DiscountType, label: "مبلغ ثابت" },
      { value: "percent" as DiscountType, label: "نسبة مئوية" },
    ],
    []
  );

  const discountLabel =
    discountOptions.find((o) => o.value === form.discountType)?.label || "اختر";

  useEffect(() => {
    if (!discountOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = discountWrapRef.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      setDiscountOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDiscountOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [discountOpen]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const servicesFlat: FlatService[] = useMemo(() => {
    const out: FlatService[] = [];
    Object.entries(pricingSections).forEach(([sectionId, section]) => {
      section.services.forEach((cat, catIdx) => {
        cat.items.forEach((it, itemIdx) => {
          const id = `${sectionId}-${catIdx}-${itemIdx}`;
          out.push({
            id,
            sectionId,
            sectionTitle: section.title,
            category: cat.category,
            name: `${cat.category} - ${it.name}`,
            basePrice: extractMinPrice(it.price),
          });
        });
      });
    });
    return out;
  }, []);

  const servicesFiltered = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return servicesFlat;
    return servicesFlat.filter((s) =>
      `${s.sectionTitle} ${s.category} ${s.name}`
        .toLowerCase()
        .includes(q)
    );
  }, [servicesFlat, serviceSearch]);

  const servicesGrouped = useMemo(() => {
    const map = new Map<string, FlatService[]>();
    servicesFiltered.forEach((s) => {
      const key = `${s.sectionTitle} — ${s.category}`;
      const arr = map.get(key) || [];
      arr.push(s);
      map.set(key, arr);
    });
    return Array.from(map.entries());
  }, [servicesFiltered]);

  const refresh = async () => {
    const data = await listOffers(SALON_ID);
    setOffers(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    refresh();
  }, []);

  const openAdd = () => {
    setEditing(null);
    setPickedImageName("");
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

  const onPickImage = async (file: File | null) => {
    if (!file) return;
    if (file.size / (1024 * 1024) > MAX_IMAGE_MB)
      return alert("الصورة أكبر من الحجم المسموح");
    setPickedImageName(file.name);
    const b64 = await fileToBase64(file);
    setForm((p) => ({ ...p, imageUrl: b64 }));
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
