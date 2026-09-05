import { Request } from "express";

export const parseDateRange = (query: Request["query"], defaultDays = 30) => {
  const { startDate, endDate } = query;
  let end: Date;
  if (typeof endDate === "string" && !Number.isNaN(new Date(endDate).getTime())) {
    end = new Date(endDate);
  } else {
    end = new Date();
  }
  end.setHours(23, 59, 59, 999);

  let start: Date;
  if (typeof startDate === "string" && !Number.isNaN(new Date(startDate).getTime())) {
    start = new Date(startDate);
  } else {
    start = new Date(end);
    start.setDate(start.getDate() - defaultDays);
  }
  start.setHours(0, 0, 0, 0);

  return { start, end };
};

export const parseLimit = (query: Request["query"], fallback: number, max = 100) => {
  const raw = Number(query.limit);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.trunc(raw), max);
};

export const parseGranularity = (query: Request["query"]): "day" | "week" | "month" => {
  if (query.granularity === "week" || query.granularity === "month") return query.granularity;
  return "day";
};
