import type { PackageServiceItem } from "../services/firestorePackages";
import type { CartItem } from "../types/bookingShared";

type FlatServiceLike = {
  id: string;
  kind: "service" | "package";
  sectionId: string;
  sectionTitle: string;
  categoryId?: string;
  category: string;
  name: string;
  basePrice: number;
  seasonPrice?: number;
  durationMin?: number;
  packageId?: string;
  packageServiceIds?: string[];
  packageServices?: PackageServiceItem[];
  packageBaseTotalPrice?: number;
};

type ServiceDocLike = {
  name?: string;
  basePrice?: number;
  durationMin?: number;
  sectionId?: string;
  sectionTitle?: string;
  categoryId?: string;
  category?: string;
} | null | undefined;

type PricedItemValues = {
  serviceBasePrice: number;
  toolsFeeApplied: number;
  basePrice: number;
  priceText: string;
};

type EffectivePriceArgs = {
  basePrice: number;
  seasonPrice?: number;
  appSettings: any;
  dateISO: string;
};

type EffectivePriceResult = {
  price?: number | null;
};

type PackagePriceRow<ServiceDoc extends ServiceDocLike = ServiceDocLike> = {
  serviceId: string;
  meta: PackageServiceItem;
  serviceDoc: ServiceDoc;
  base: number;
  price: number;
};

export function distributePackageServicePrices<ServiceDoc extends ServiceDocLike>(args: {
  service: FlatServiceLike;
  getServiceById: (serviceId: string) => ServiceDoc;
}): Array<PackagePriceRow<ServiceDoc>> {
  const pkgServices = Array.isArray(args.service.packageServices)
    ? args.service.packageServices
    : [];
  const pkgServiceIds = (Array.isArray(args.service.packageServiceIds)
    ? args.service.packageServiceIds
    : []
  )
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const serviceIds = pkgServices.length
    ? pkgServices
        .map((item) => String(item?.serviceId || "").trim())
        .filter(Boolean)
    : pkgServiceIds;

  if (!serviceIds.length) return [];

  const baseByService = serviceIds.map((serviceId, idx) => {
    const meta = pkgServices[idx] || ({} as PackageServiceItem);
    const serviceDoc = args.getServiceById(serviceId);
    const base = Math.max(
      0,
      Number((meta as any)?.price ?? (serviceDoc as any)?.basePrice ?? 0)
    );
    return { serviceId, meta, serviceDoc, base };
  });

  const baseTotal = baseByService.reduce((sum, row) => sum + Number(row.base || 0), 0);
  const packageFinal = Math.max(0, Number(args.service.basePrice || 0));
  const targetTotal = packageFinal > 0 ? packageFinal : baseTotal;

  const splitCount = Math.max(1, baseByService.length);
  const equalShare = Math.floor((targetTotal / splitCount) * 100) / 100;
  const remaining = Math.round((targetTotal - equalShare * splitCount) * 100) / 100;

  return baseByService.map((row, idx) => {
    if (idx === splitCount - 1) {
      const last = Math.max(0, Number((equalShare + remaining).toFixed(2)));
      return { ...row, price: last };
    }
    return { ...row, price: Math.max(0, Number(equalShare.toFixed(2))) };
  });
}

export function buildPackageSnapshot(args: {
  service: FlatServiceLike;
  distributedRows: Array<PackagePriceRow>;
  defaultServiceDurationMin: number;
}): NonNullable<CartItem["packageSnapshot"]> {
  const baseTotal = args.distributedRows.reduce((sum, row) => sum + Number(row.base || 0), 0);
  const packageFinal = Math.max(0, Number(args.service.basePrice || 0));
  const targetTotal = packageFinal > 0 ? packageFinal : baseTotal;
  const pkgServices = Array.isArray(args.service.packageServices)
    ? args.service.packageServices
    : [];

  return {
    packageId: String(args.service.packageId || "").trim(),
    packageName: args.service.name,
    finalPriceAtBooking: targetTotal,
    baseTotalPriceAtBooking: Number(
      args.service.packageBaseTotalPrice || baseTotal || targetTotal
    ),
    totalDurationMinAtBooking: Number(
      args.service.durationMin || args.defaultServiceDurationMin
    ),
    serviceIds: args.distributedRows.map((row) => row.serviceId),
    services: pkgServices,
  };
}

export function buildPackageCartItems<ServiceDoc extends ServiceDocLike>(args: {
  service: FlatServiceLike;
  distributedRows: Array<PackagePriceRow<ServiceDoc>>;
  packageSnapshot: NonNullable<CartItem["packageSnapshot"]>;
  packageRunId: string;
  bookingDate: string;
  createLocalId: () => string;
  defaultServiceDurationMin: number;
  isToolsEligibleForSection: (sectionId: string, sectionTitle: string) => boolean;
  buildItemPriceWithTools: (
    serviceBasePrice: number,
    toolsSource: CartItem["toolsSource"],
    toolsEligible: boolean
  ) => PricedItemValues;
}): CartItem[] {
  return args.distributedRows.map((row) => {
    const serviceName = String(
      (row.meta as any)?.serviceName || (row.serviceDoc as any)?.name || row.serviceId
    ).trim();
    const durationMin = Math.max(
      1,
      Number(
        (row.meta as any)?.durationMin ||
          (row.serviceDoc as any)?.durationMin ||
          args.defaultServiceDurationMin
      )
    );
    const sectionId = String(
      (row.meta as any)?.sectionId || (row.serviceDoc as any)?.sectionId || ""
    ).trim();
    const sectionTitle = String((row.serviceDoc as any)?.sectionTitle || sectionId).trim();
    const categoryId = String(
      (row.meta as any)?.categoryId || (row.serviceDoc as any)?.categoryId || ""
    ).trim();
    const categoryName = String((row.serviceDoc as any)?.category || categoryId).trim();
    const toolsEligible = args.isToolsEligibleForSection(sectionId, sectionTitle);
    const toolsSource = toolsEligible ? "client" : undefined;
    const priced = args.buildItemPriceWithTools(
      Number(row.price || 0),
      toolsSource,
      toolsEligible
    );

    return {
      id: args.createLocalId(),
      packageRunId: args.packageRunId,
      serviceId: row.serviceId,
      serviceName,
      packageId: String(args.service.packageId || "").trim(),
      packageSnapshot: args.packageSnapshot,
      serviceBasePrice: priced.serviceBasePrice,
      basePrice: priced.basePrice,
      priceText: priced.priceText,
      durationMin,
      employeeId: "",
      employeeUid: "",
      employeeName: "",
      date: args.bookingDate,
      time: "",
      locked: false,
      serviceSectionId: sectionId,
      serviceSectionTitle: sectionTitle || undefined,
      serviceCategoryId: categoryId || undefined,
      serviceCategoryName: categoryName || undefined,
      toolsSource,
      toolsFeeApplied: priced.toolsFeeApplied,
    };
  });
}

export function buildSingleServiceCartItem(args: {
  service: FlatServiceLike;
  bookingDate: string;
  appSettings: any;
  createLocalId: () => string;
  defaultServiceDurationMin: number;
  resolveEffectivePrice: (args: EffectivePriceArgs) => EffectivePriceResult;
  isToolsEligibleForService: (service: FlatServiceLike) => boolean;
  buildItemPriceWithTools: (
    serviceBasePrice: number,
    toolsSource: CartItem["toolsSource"],
    toolsEligible: boolean
  ) => PricedItemValues;
}): CartItem {
  const dateISO = String(args.bookingDate || "").trim();
  const eff = args.resolveEffectivePrice({
    basePrice: Number(args.service.basePrice || 0),
    seasonPrice: Number(args.service.seasonPrice || 0) || undefined,
    appSettings: args.appSettings,
    dateISO,
  });
  const serviceBasePrice = Number(eff.price || 0);
  const toolsEligible = args.isToolsEligibleForService(args.service);
  const toolsSource = toolsEligible ? "client" : undefined;
  const priced = args.buildItemPriceWithTools(serviceBasePrice, toolsSource, toolsEligible);

  return {
    id: args.createLocalId(),
    serviceId: args.service.id,
    serviceName: args.service.name,
    packageId:
      args.service.kind === "package" ? String(args.service.packageId || "").trim() : undefined,
    packageSnapshot:
      args.service.kind === "package" && args.service.packageId
        ? {
            packageId: String(args.service.packageId || "").trim(),
            packageName: args.service.name,
            finalPriceAtBooking: Number(args.service.basePrice || 0),
            baseTotalPriceAtBooking: Number(
              args.service.packageBaseTotalPrice || args.service.basePrice || 0
            ),
            totalDurationMinAtBooking: Number(
              args.service.durationMin || args.defaultServiceDurationMin
            ),
            serviceIds: Array.isArray(args.service.packageServiceIds)
              ? args.service.packageServiceIds
              : [],
            services: Array.isArray(args.service.packageServices)
              ? args.service.packageServices
              : [],
          }
        : undefined,
    serviceBasePrice: priced.serviceBasePrice,
    basePrice: priced.basePrice,
    priceText: priced.priceText,
    toolsSource,
    toolsFeeApplied: priced.toolsFeeApplied,
    durationMin: Number(args.service.durationMin || args.defaultServiceDurationMin),
    employeeId: "",
    employeeUid: "",
    employeeName: "",
    date: args.bookingDate,
    time: "",
    locked: false,
    serviceSectionId: String(args.service.sectionId || "").trim(),
    serviceSectionTitle: String(args.service.sectionTitle || "").trim() || undefined,
    serviceCategoryId: String(args.service.categoryId || "").trim() || undefined,
    serviceCategoryName: String(args.service.category || "").trim() || undefined,
  };
}
