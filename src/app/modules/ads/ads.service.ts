import { StatusCodes } from "http-status-codes";
import { AdEventType, AdStatus, AdType, Prisma } from "@prisma/client";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";
import { optimizeAndSaveImage } from "../../utils/imageOptimizer";

/**
 * The slots that ship with the blog. Seeded once on boot so the Placements
 * board is never empty; teams can add their own alongside them.
 */
const SYSTEM_PLACEMENTS = [
  {
    key: "header-banner",
    name: "Header Banner",
    description: "Shows below the site nav, on every blog page",
    width: 728,
    height: 90,
    isNative: false,
    sortOrder: 1,
  },
  {
    key: "sidebar-rectangle",
    name: "Sidebar Rectangle",
    description: "Sticky in the right rail on desktop only",
    width: 300,
    height: 250,
    isNative: false,
    sortOrder: 2,
  },
  {
    key: "in-article-native",
    name: "In-Article Native",
    description: "Inserted after the 3rd paragraph automatically",
    width: null,
    height: null,
    isNative: true,
    sortOrder: 3,
  },
  {
    key: "footer-banner",
    name: "Footer Banner",
    description: "Above comments, end of every post",
    width: 728,
    height: 90,
    isNative: false,
    sortOrder: 4,
  },
  {
    key: "mobile-sticky",
    name: "Mobile Sticky",
    description: "Bottom-anchored bar, mobile web only",
    width: 320,
    height: 50,
    isNative: false,
    sortOrder: 5,
  },
  {
    key: "blog-grid-card",
    name: "Stories Grid Card",
    description: "Takes a card's place in the Stories grid, every 9th slot",
    width: 486,
    height: 267,
    isNative: false,
    sortOrder: 6,
  },
  {
    key: "sidebar-tower",
    name: "Sidebar Tower",
    description: "Tall unit at the top of a post's right rail",
    width: 300,
    height: 600,
    isNative: false,
    sortOrder: 7,
  },
  {
    key: "sidebar-square",
    name: "Sidebar Square",
    description: "Square unit below the tower in a post's right rail",
    width: 300,
    height: 300,
    isNative: false,
    sortOrder: 8,
  },
];

export const seedSystemPlacements = async () => {
  for (const placement of SYSTEM_PLACEMENTS) {
    await prisma.adPlacement.upsert({
      where: { key: placement.key },
      // Keep built-in copy in step with the code, but never clobber sizes an
      // operator has deliberately changed on a custom slot.
      update: { name: placement.name, description: placement.description },
      create: { ...placement, isSystem: true },
    });
  }
};

const AD_INCLUDE = {
  placement: { select: { id: true, key: true, name: true, width: true, height: true, isNative: true } },
  categories: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.AdInclude;

type AdRow = Prisma.AdGetPayload<{ include: typeof AD_INCLUDE }>;

/**
 * The date window beats the stored status: an ad past its end date is expired
 * whatever the column says, and one waiting to start is scheduled. Drafts and
 * paused ads are held as-is — those are deliberate operator choices.
 */
const effectiveStatus = (ad: { status: AdStatus; startsAt: Date | null; endsAt: Date | null }): AdStatus => {
  if (ad.status === AdStatus.DRAFT || ad.status === AdStatus.PAUSED) return ad.status;

  const now = new Date();
  if (ad.endsAt && ad.endsAt < now) return AdStatus.EXPIRED;
  if (ad.startsAt && ad.startsAt > now) return AdStatus.SCHEDULED;
  return AdStatus.ACTIVE;
};

const ctr = (impressions: number, clicks: number) =>
  impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0;

const shape = (ad: AdRow) => ({
  id: ad.id,
  name: ad.name,
  type: ad.type,
  sponsorName: ad.sponsorName,
  sponsorEmail: ad.sponsorEmail,
  placement: ad.placement,
  placementId: ad.placementId,
  status: effectiveStatus(ad),
  /** What the operator actually chose, before the date window is applied. */
  storedStatus: ad.status,
  imageUrl: ad.imageUrl,
  htmlSnippet: ad.htmlSnippet,
  targetUrl: ad.targetUrl,
  openInNewTab: ad.openInNewTab,
  priority: ad.priority,
  frequencyCap: ad.frequencyCap,
  utmSource: ad.utmSource,
  utmMedium: ad.utmMedium,
  utmCampaign: ad.utmCampaign,
  categories: ad.categories,
  startsAt: ad.startsAt?.toISOString() ?? null,
  endsAt: ad.endsAt?.toISOString() ?? null,
  impressions: ad.impressions,
  clicks: ad.clicks,
  ctr: ctr(ad.impressions, ad.clicks),
  createdAt: ad.createdAt.toISOString(),
  updatedAt: ad.updatedAt.toISOString(),
});

export type AdPayload = {
  name: string;
  type?: AdType;
  sponsorName?: string | null;
  sponsorEmail?: string | null;
  placementId?: string | null;
  status?: AdStatus;
  imageUrl?: string | null;
  htmlSnippet?: string | null;
  targetUrl?: string | null;
  openInNewTab?: boolean;
  priority?: number;
  frequencyCap?: number | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  categoryIds?: string[];
  startsAt?: string | null;
  endsAt?: string | null;
};

// ----------------------------------- Ads -----------------------------------

const listAds = async (filters: {
  searchTerm?: string;
  status?: string;
  type?: string;
  placementId?: string;
}) => {
  const where: Prisma.AdWhereInput = {
    ...(filters.type && filters.type !== "ALL" ? { type: filters.type as AdType } : {}),
    ...(filters.placementId && filters.placementId !== "ALL"
      ? { placementId: filters.placementId }
      : {}),
    ...(filters.searchTerm
      ? {
          OR: [
            { name: { contains: filters.searchTerm, mode: "insensitive" } },
            { sponsorName: { contains: filters.searchTerm, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const rows = await prisma.ad.findMany({
    where,
    include: AD_INCLUDE,
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  // Status is derived, so it has to be filtered after shaping rather than in
  // the query.
  return rows
    .map(shape)
    .filter((ad) =>
      filters.status && filters.status !== "ALL" ? ad.status === filters.status : true,
    );
};

const countEvents = (type: AdEventType, from: Date, to?: Date) =>
  prisma.adEvent.count({
    where: { type, createdAt: { gte: from, ...(to ? { lt: to } : {}) } },
  });

/**
 * Headline figures for the All Ads tab. Impressions and clicks are reported
 * over the last 30 days and compared with the 30 days before that, which is
 * what makes the percentage meaningful.
 */
const getAdStats = async () => {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const priorStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const [ads, impressions, clicks, priorImpressions, priorClicks] = await Promise.all([
    prisma.ad.findMany({ select: { status: true, startsAt: true, endsAt: true } }),
    countEvents(AdEventType.IMPRESSION, windowStart),
    countEvents(AdEventType.CLICK, windowStart),
    countEvents(AdEventType.IMPRESSION, priorStart, windowStart),
    countEvents(AdEventType.CLICK, priorStart, windowStart),
  ]);

  const resolved = ads.map(effectiveStatus);
  const change = (current: number, prior: number) =>
    prior > 0 ? Math.round(((current - prior) / prior) * 100) : null;

  return {
    activeAds: resolved.filter((status) => status === AdStatus.ACTIVE).length,
    scheduledAds: resolved.filter((status) => status === AdStatus.SCHEDULED).length,
    totalAds: ads.length,
    impressions30d: impressions,
    clicks30d: clicks,
    impressionsChangePercent: change(impressions, priorImpressions),
    clicksChangePercent: change(clicks, priorClicks),
    ctr30d: ctr(impressions, clicks),
  };
};

const getAdById = async (id: string) => {
  const ad = await prisma.ad.findUnique({ where: { id }, include: AD_INCLUDE });
  if (!ad) throw new ApiError(StatusCodes.NOT_FOUND, "Ad not found");
  return shape(ad);
};

/** A sponsored ad without a sponsor name would show a blank column. */
const assertSponsor = (type: AdType | undefined, sponsorName?: string | null) => {
  if (type === AdType.SPONSORED && !sponsorName?.trim()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Sponsored ads need a sponsor name");
  }
};

const createAd = async (payload: AdPayload) => {
  assertSponsor(payload.type, payload.sponsorName);

  const ad = await prisma.ad.create({
    data: {
      name: payload.name,
      type: payload.type ?? AdType.INTERNAL,
      // Sponsor fields only belong on sponsored ads.
      sponsorName: payload.type === AdType.SPONSORED ? payload.sponsorName ?? null : null,
      sponsorEmail: payload.type === AdType.SPONSORED ? payload.sponsorEmail ?? null : null,
      placementId: payload.placementId ?? null,
      status: payload.status ?? AdStatus.DRAFT,
      imageUrl: payload.imageUrl ?? null,
      htmlSnippet: payload.htmlSnippet ?? null,
      targetUrl: payload.targetUrl ?? null,
      openInNewTab: payload.openInNewTab ?? true,
      priority: payload.priority ?? 50,
      frequencyCap: payload.frequencyCap ?? null,
      utmSource: payload.utmSource ?? null,
      utmMedium: payload.utmMedium ?? null,
      utmCampaign: payload.utmCampaign ?? null,
      startsAt: payload.startsAt ? new Date(payload.startsAt) : null,
      endsAt: payload.endsAt ? new Date(payload.endsAt) : null,
      categories: payload.categoryIds?.length
        ? { connect: payload.categoryIds.map((id) => ({ id })) }
        : undefined,
    },
    include: AD_INCLUDE,
  });

  return shape(ad);
};

const updateAd = async (id: string, payload: Partial<AdPayload>) => {
  const existing = await prisma.ad.findUnique({ where: { id } });
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "Ad not found");

  const type = payload.type ?? existing.type;
  assertSponsor(type, payload.sponsorName ?? existing.sponsorName);

  const ad = await prisma.ad.update({
    where: { id },
    data: {
      ...(payload.name !== undefined && { name: payload.name }),
      ...(payload.type !== undefined && { type: payload.type }),
      // Switching back to internal must clear the sponsor fields.
      ...(type === AdType.SPONSORED
        ? {
            ...(payload.sponsorName !== undefined && { sponsorName: payload.sponsorName }),
            ...(payload.sponsorEmail !== undefined && { sponsorEmail: payload.sponsorEmail }),
          }
        : { sponsorName: null, sponsorEmail: null }),
      ...(payload.placementId !== undefined && { placementId: payload.placementId }),
      ...(payload.status !== undefined && { status: payload.status }),
      ...(payload.imageUrl !== undefined && { imageUrl: payload.imageUrl }),
      ...(payload.htmlSnippet !== undefined && { htmlSnippet: payload.htmlSnippet }),
      ...(payload.targetUrl !== undefined && { targetUrl: payload.targetUrl }),
      ...(payload.openInNewTab !== undefined && { openInNewTab: payload.openInNewTab }),
      ...(payload.priority !== undefined && { priority: payload.priority }),
      ...(payload.frequencyCap !== undefined && { frequencyCap: payload.frequencyCap }),
      ...(payload.utmSource !== undefined && { utmSource: payload.utmSource }),
      ...(payload.utmMedium !== undefined && { utmMedium: payload.utmMedium }),
      ...(payload.utmCampaign !== undefined && { utmCampaign: payload.utmCampaign }),
      ...(payload.startsAt !== undefined && {
        startsAt: payload.startsAt ? new Date(payload.startsAt) : null,
      }),
      ...(payload.endsAt !== undefined && {
        endsAt: payload.endsAt ? new Date(payload.endsAt) : null,
      }),
      ...(payload.categoryIds !== undefined && {
        categories: { set: payload.categoryIds.map((categoryId) => ({ id: categoryId })) },
      }),
    },
    include: AD_INCLUDE,
  });

  return shape(ad);
};

const deleteAd = async (id: string) => {
  await prisma.ad.delete({ where: { id } }).catch(() => {
    throw new ApiError(StatusCodes.NOT_FOUND, "Ad not found");
  });
  return { id };
};

const bulkDelete = async (ids: string[]) => {
  const { count } = await prisma.ad.deleteMany({ where: { id: { in: ids } } });
  return { count };
};

const bulkUpdateStatus = async (ids: string[], status: AdStatus) => {
  const { count } = await prisma.ad.updateMany({ where: { id: { in: ids } }, data: { status } });
  return { count };
};

const uploadCreative = async (file: Express.Multer.File) => {
  const filename = await optimizeAndSaveImage(file, "ads");
  return { url: `/uploads/ads/${filename}` };
};

// -------------------------------- Placements --------------------------------

/** The Placements board: every slot with the ad currently filling it. */
const listPlacements = async () => {
  const rows = await prisma.adPlacement.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      ads: {
        include: AD_INCLUDE,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      },
    },
  });

  return rows.map((placement) => {
    const ads = placement.ads.map(shape);
    // Whatever a visitor would actually see in this slot right now.
    const current =
      ads.find((ad) => ad.status === AdStatus.ACTIVE) ??
      ads.find((ad) => ad.status === AdStatus.SCHEDULED) ??
      null;

    return {
      id: placement.id,
      key: placement.key,
      name: placement.name,
      description: placement.description,
      width: placement.width,
      height: placement.height,
      isNative: placement.isNative,
      isSystem: placement.isSystem,
      adCount: ads.length,
      currentAd: current
        ? {
            id: current.id,
            name: current.name,
            type: current.type,
            status: current.status,
            sponsorName: current.sponsorName,
          }
        : null,
    };
  });
};

const createPlacement = async (payload: {
  name: string;
  description?: string | null;
  width?: number | null;
  height?: number | null;
  isNative?: boolean;
}) => {
  const key = payload.name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");

  const clash = await prisma.adPlacement.findUnique({ where: { key } });
  if (clash) throw new ApiError(StatusCodes.CONFLICT, "That placement already exists");

  const last = await prisma.adPlacement.findFirst({ orderBy: { sortOrder: "desc" } });

  return prisma.adPlacement.create({
    data: {
      key,
      name: payload.name.trim(),
      description: payload.description ?? null,
      width: payload.isNative ? null : payload.width ?? null,
      height: payload.isNative ? null : payload.height ?? null,
      isNative: payload.isNative ?? false,
      isSystem: false,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
};

const updatePlacement = async (
  id: string,
  payload: { name?: string; description?: string | null; width?: number | null; height?: number | null },
) => {
  const existing = await prisma.adPlacement.findUnique({ where: { id } });
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "Placement not found");

  return prisma.adPlacement.update({
    where: { id },
    data: {
      ...(payload.name !== undefined && { name: payload.name }),
      ...(payload.description !== undefined && { description: payload.description }),
      ...(payload.width !== undefined && { width: payload.width }),
      ...(payload.height !== undefined && { height: payload.height }),
    },
  });
};

const deletePlacement = async (id: string) => {
  const existing = await prisma.adPlacement.findUnique({
    where: { id },
    include: { _count: { select: { ads: true } } },
  });
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "Placement not found");

  if (existing.isSystem) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Built-in placements cannot be deleted");
  }
  if (existing._count.ads > 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `${existing._count.ads} ad(s) still use this placement. Move or delete them first.`,
    );
  }

  await prisma.adPlacement.delete({ where: { id } });
  return { id };
};

// -------------------------------- Storefront --------------------------------

/**
 * What the blog should render in a slot: live ads only, filtered to the post's
 * category, highest priority first. UTM params are appended to the target so
 * click-throughs land already tagged.
 */
const listActiveAds = async (filters: { placementKey?: string; categoryId?: string }) => {
  const rows = await prisma.ad.findMany({
    where: {
      status: { in: [AdStatus.ACTIVE, AdStatus.SCHEDULED, AdStatus.EXPIRED] },
      ...(filters.placementKey ? { placement: { key: filters.placementKey } } : {}),
      ...(filters.categoryId
        ? { OR: [{ categories: { none: {} } }, { categories: { some: { id: filters.categoryId } } }] }
        : {}),
    },
    include: AD_INCLUDE,
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  return rows
    .map(shape)
    .filter((ad) => ad.status === AdStatus.ACTIVE)
    .map((ad) => ({
      id: ad.id,
      name: ad.name,
      type: ad.type,
      sponsorName: ad.sponsorName,
      placement: ad.placement,
      imageUrl: ad.imageUrl,
      htmlSnippet: ad.htmlSnippet,
      targetUrl: withUtm(ad),
      openInNewTab: ad.openInNewTab,
      frequencyCap: ad.frequencyCap,
    }));
};

const withUtm = (ad: ReturnType<typeof shape>) => {
  if (!ad.targetUrl) return null;
  if (!ad.utmSource && !ad.utmMedium && !ad.utmCampaign) return ad.targetUrl;

  try {
    const url = new URL(ad.targetUrl);
    if (ad.utmSource) url.searchParams.set("utm_source", ad.utmSource);
    if (ad.utmMedium) url.searchParams.set("utm_medium", ad.utmMedium);
    if (ad.utmCampaign) url.searchParams.set("utm_campaign", ad.utmCampaign);
    return url.toString();
  } catch {
    // A malformed target must not break the slot.
    return ad.targetUrl;
  }
};

/** Records the event and keeps the lifetime rollup in step, in one round trip. */
const recordEvent = async (id: string, type: AdEventType) => {
  const exists = await prisma.ad.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new ApiError(StatusCodes.NOT_FOUND, "Ad not found");

  await prisma.$transaction([
    prisma.adEvent.create({ data: { adId: id, type } }),
    prisma.ad.update({
      where: { id },
      data:
        type === AdEventType.IMPRESSION
          ? { impressions: { increment: 1 } }
          : { clicks: { increment: 1 } },
    }),
  ]);

  return { id };
};

export const AdsService = {
  seedSystemPlacements,
  listAds,
  getAdStats,
  getAdById,
  createAd,
  updateAd,
  deleteAd,
  bulkDelete,
  bulkUpdateStatus,
  uploadCreative,
  listPlacements,
  createPlacement,
  updatePlacement,
  deletePlacement,
  listActiveAds,
  recordImpression: (id: string) => recordEvent(id, AdEventType.IMPRESSION),
  recordClick: (id: string) => recordEvent(id, AdEventType.CLICK),
};
