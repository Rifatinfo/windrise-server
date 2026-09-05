import axios from "axios";
import { GoogleAuth, OAuth2Client } from "google-auth-library";

// All three integrations below are env-credential-gated: with no credentials set,
// every function resolves to `{ connected: false }` instead of throwing or faking numbers.
// Once the user supplies real credentials via env vars, the same endpoints go live.

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

// ============================= Google Analytics 4 =============================

const getGa4Config = () => {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const serviceAccountJson = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (!propertyId || !serviceAccountJson) return null;

  try {
    const credentials = JSON.parse(serviceAccountJson);
    return { propertyId, credentials };
  } catch {
    return null;
  }
};

const getGa4AccessToken = async (credentials: object) => {
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
};

const getTrafficOverview = async (startDate: string, endDate: string) => {
  const config = getGa4Config();
  if (!config) return { connected: false as const };

  try {
    const token = await getGa4AccessToken(config.credentials);
    const { data } = await axios.post(
      `https://analyticsdata.googleapis.com/v1beta/properties/${config.propertyId}:runReport`,
      {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
        ],
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const values: string[] =
      data.rows?.[0]?.metricValues?.map((m: { value: string }) => m.value) ?? [];
    const [totalUsers, newUsers, sessions, pageViews, avgSessionDuration, bounceRate] =
      values.map(Number);

    return {
      connected: true as const,
      totalVisitors: totalUsers || 0,
      uniqueVisitors: totalUsers || 0,
      newUsers: newUsers || 0,
      returningUsers: Math.max((totalUsers || 0) - (newUsers || 0), 0),
      sessions: sessions || 0,
      pageViews: pageViews || 0,
      avgSessionDurationSeconds: round1(avgSessionDuration || 0),
      bounceRate: round1((bounceRate || 0) * 100),
    };
  } catch (error) {
    return {
      connected: true as const,
      error: error instanceof Error ? error.message : "Failed to fetch GA4 traffic data",
    };
  }
};

const getTrafficSources = async (startDate: string, endDate: string) => {
  const config = getGa4Config();
  if (!config) return { connected: false as const };

  try {
    const token = await getGa4AccessToken(config.credentials);
    const { data } = await axios.post(
      `https://analyticsdata.googleapis.com/v1beta/properties/${config.propertyId}:runReport`,
      {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const rows: Array<{ dimensionValues: { value: string }[]; metricValues: { value: string }[] }> =
      data.rows ?? [];
    const total = rows.reduce((sum, row) => sum + Number(row.metricValues[0]?.value ?? 0), 0);

    const sources = rows.map((row) => {
      const sessions = Number(row.metricValues[0]?.value ?? 0);
      return {
        source: row.dimensionValues[0]?.value ?? "Unknown",
        sessions,
        percentage: total === 0 ? 0 : round1((sessions / total) * 100),
      };
    });

    return { connected: true as const, sources };
  } catch (error) {
    return {
      connected: true as const,
      error: error instanceof Error ? error.message : "Failed to fetch GA4 traffic sources",
    };
  }
};

// ============================= Meta (Facebook/Instagram) Ads =============================

const getMetaAdsPerformance = async (startDate: string, endDate: string) => {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accountId || !accessToken) return { connected: false as const };

  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v20.0/act_${accountId}/insights`,
      {
        params: {
          access_token: accessToken,
          time_range: JSON.stringify({ since: startDate, until: endDate }),
          fields: "spend,impressions,clicks,actions,action_values",
        },
      },
    );

    const row = data.data?.[0];
    const findAction = (arr: Array<{ action_type: string; value: string }> | undefined, type: string) =>
      Number(arr?.find((a) => a.action_type === type)?.value ?? 0);

    const spend = Number(row?.spend ?? 0);
    const purchases =
      findAction(row?.actions, "omni_purchase") || findAction(row?.actions, "purchase");
    const revenue =
      findAction(row?.action_values, "omni_purchase") || findAction(row?.action_values, "purchase");

    return {
      connected: true as const,
      spend,
      impressions: Number(row?.impressions ?? 0),
      clicks: Number(row?.clicks ?? 0),
      addToCart: findAction(row?.actions, "add_to_cart"),
      initiateCheckout: findAction(row?.actions, "initiate_checkout"),
      purchases,
      revenue,
      costPerPurchase: purchases === 0 ? 0 : round2(spend / purchases),
      roas: spend === 0 ? 0 : round2(revenue / spend),
    };
  } catch (error) {
    return {
      connected: true as const,
      error: error instanceof Error ? error.message : "Failed to fetch Meta Ads data",
    };
  }
};

// ============================= Google Ads =============================

const getGoogleAdsAccessToken = async () => {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  return token ?? null;
};

const getGoogleAdsPerformance = async (startDate: string, endDate: string) => {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!developerToken || !customerId) return { connected: false as const };

  const accessToken = await getGoogleAdsAccessToken();
  if (!accessToken) return { connected: false as const };

  try {
    const query = `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
      FROM customer
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`;

    const { data } = await axios.post(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
      { query },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": developerToken,
        },
      },
    );

    type Row = {
      metrics?: {
        costMicros?: string;
        impressions?: string;
        clicks?: string;
        conversions?: string;
        conversionsValue?: string;
      };
    };

    const totals = ((data.results ?? []) as Row[]).reduce(
      (acc, row) => {
        acc.spend += Number(row.metrics?.costMicros ?? 0) / 1_000_000;
        acc.impressions += Number(row.metrics?.impressions ?? 0);
        acc.clicks += Number(row.metrics?.clicks ?? 0);
        acc.conversions += Number(row.metrics?.conversions ?? 0);
        acc.conversionValue += Number(row.metrics?.conversionsValue ?? 0);
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 },
    );

    return {
      connected: true as const,
      spend: round2(totals.spend),
      impressions: totals.impressions,
      clicks: totals.clicks,
      conversions: totals.conversions,
      conversionValue: round2(totals.conversionValue),
      costPerConversion: totals.conversions === 0 ? 0 : round2(totals.spend / totals.conversions),
      roas: totals.spend === 0 ? 0 : round2(totals.conversionValue / totals.spend),
    };
  } catch (error) {
    return {
      connected: true as const,
      error: error instanceof Error ? error.message : "Failed to fetch Google Ads data",
    };
  }
};

// ============================= Rollup =============================

const getMarketingPerformance = async (startDate: string, endDate: string) => {
  const [meta, google] = await Promise.all([
    getMetaAdsPerformance(startDate, endDate),
    getGoogleAdsPerformance(startDate, endDate),
  ]);

  return { meta, google };
};

export const MarketingService = {
  getTrafficOverview,
  getTrafficSources,
  getMetaAdsPerformance,
  getGoogleAdsPerformance,
  getMarketingPerformance,
};
