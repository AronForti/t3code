import { useAtomValue } from "@effect/atom-react";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import {
  isProviderAvailable,
  type EnvironmentId,
  type ProviderDriverKind,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  cursorUsageWindowDetails,
  displayLimitWindows,
  formatDuration,
  formatResetsIn,
  type LimitPace,
  type LimitPool,
  type LimitPoolWindow,
  limitsNotice,
  paceOf,
} from "@t3tools/shared/usageLimits";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { RefreshIcon } from "../ui/refresh-icon";
import { barColor } from "./UsageLimits";

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: "Ahead of pace",
  on: "On pace",
  under: "Under pace",
};

export interface ProviderDockItem {
  readonly driver: ProviderDriverKind;
  readonly label: string;
  readonly accentColor: string | undefined;
  readonly acpRegistryIconUrl: string | undefined;
  readonly pool: LimitPool | null;
  readonly primaryRemainingPercent: number | null;
  readonly unavailableNotice: string | null;
}

export function buildProviderDockItems(
  presentations: Parameters<typeof collectLimitAccounts>[0],
  now: number,
): readonly ProviderDockItem[] {
  const poolsByDriver = new Map<ProviderDriverKind, LimitPool>();
  for (const pool of collectLimitPools(collectLimitAccounts(presentations), now)) {
    poolsByDriver.set(pool.driver, pool);
  }

  const connectedByDriver = new Map<
    ProviderDriverKind,
    {
      readonly provider: ServerProvider;
      readonly notices: string[];
    }
  >();

  for (const presentation of presentations.values()) {
    for (const provider of presentation.serverConfig?.providers ?? []) {
      if (
        !provider.enabled ||
        !provider.installed ||
        !isProviderAvailable(provider) ||
        provider.auth.status === "unauthenticated"
      ) {
        continue;
      }
      const existing = connectedByDriver.get(provider.driver);
      const notice = provider.usageLimits ? limitsNotice(provider.usageLimits) : null;
      if (!existing) {
        connectedByDriver.set(provider.driver, {
          provider,
          notices: notice ? [notice] : [],
        });
      } else if (notice && !existing.notices.includes(notice)) {
        existing.notices.push(notice);
      }
    }
  }

  const drivers = new Set<ProviderDriverKind>([
    ...connectedByDriver.keys(),
    ...poolsByDriver.keys(),
  ]);

  const items: ProviderDockItem[] = [];
  for (const driver of drivers) {
    const pool = poolsByDriver.get(driver) ?? null;
    const connected = connectedByDriver.get(driver)?.provider;
    const windows = pool ? displayLimitWindows(pool) : [];
    const primaryWindow = windows[0] ?? null;
    const primaryRemainingPercent = primaryWindow ? primaryWindow.remainingPercent : null;
    const label =
      providerClients.get(driver)?.label ??
      connected?.displayName?.trim() ??
      pool?.accounts[0]?.displayName ??
      String(driver);
    const accentColor = connected?.accentColor ?? pool?.accounts[0]?.accentColor;
    const notices = connectedByDriver.get(driver)?.notices ?? [];

    items.push({
      driver,
      label,
      accentColor,
      acpRegistryIconUrl: connected?.iconUrl,
      pool,
      primaryRemainingPercent,
      unavailableNotice:
        windows.length === 0 ? (notices[0] ?? "Usage limits unavailable for this provider.") : null,
    });
  }

  return items;
}

function ringStrokeColor(item: ProviderDockItem): string {
  if (item.primaryRemainingPercent === null) {
    return "color-mix(in oklab, var(--color-muted-foreground) 40%, transparent)";
  }
  if (item.primaryRemainingPercent <= 10) {
    return "var(--color-error)";
  }
  if (item.primaryRemainingPercent <= 20) {
    return "var(--color-warning)";
  }
  return normalizeProviderAccentColor(item.accentColor) ?? barColor(item.driver);
}

function DockWindowRow({
  driver,
  window,
  color,
  now,
}: {
  readonly driver: ProviderDriverKind;
  readonly window: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const details = driver === "cursor" ? cursorUsageWindowDetails(window.id) : undefined;
  const label = details?.label ?? window.label;
  const left = window.remainingPercent;
  const firstMemberWindow: ServerProviderUsageWindow | undefined = window.members[0]?.window;
  const pace = window.pace ?? (firstMemberWindow ? paceOf(firstMemberWindow, now) : null);
  const resetsIn = firstMemberWindow ? formatResetsIn(firstMemberWindow, now) : null;
  const resetsAtIso = firstMemberWindow?.resetsAt;
  const resetsAtMs = resetsAtIso ? Date.parse(resetsAtIso) : Number.NaN;
  const tone = left <= 10 ? "error" : left <= 20 ? "warning" : null;
  const fillColor =
    tone === "error" ? "var(--color-error)" : tone === "warning" ? "var(--color-warning)" : color;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-medium text-foreground">{label}</span>
        <span
          className={cn(
            "shrink-0 font-semibold tabular-nums",
            tone === "error"
              ? "text-error-foreground"
              : tone === "warning"
                ? "text-warning-foreground"
                : "text-foreground",
          )}
        >
          {left}% left
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted/70"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={left}
        aria-label={`${label} usage remaining`}
      >
        {left > 0 ? (
          <div
            className="h-full rounded-full transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `max(${left}%, 4px)`, backgroundColor: fillColor }}
          />
        ) : null}
      </div>
      {resetsIn || pace ? (
        <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground tabular-nums">
          <span>
            {resetsAtIso && resetsAtMs > now
              ? `Resets in ${formatDuration(resetsAtMs - now)} · ${formatUpcomingTimestamp(resetsAtIso, timestampFormat, now)}`
              : (resetsIn ?? "")}
          </span>
          {pace ? <span className="ms-auto shrink-0">{PACE_LABEL[pace]}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function ProviderUsageDockButton({
  item,
  now,
  isRefreshing,
  onRefresh,
  onOpenUsagePage,
}: {
  readonly item: ProviderDockItem;
  readonly now: number;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onOpenUsagePage: () => void;
}) {
  const remaining = item.primaryRemainingPercent;
  const normalizedRemaining = remaining === null ? 0 : Math.max(0, Math.min(100, remaining));
  const radius = 11.25;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedRemaining / 100);
  const strokeColor = ringStrokeColor(item);
  const barAccent = normalizeProviderAccentColor(item.accentColor) ?? barColor(item.driver);
  const windows = item.pool ? displayLimitWindows(item.pool) : [];
  const accountPlan = item.pool?.accounts.find((account) => account.plan)?.plan;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={150}
        render={
          <button
            type="button"
            onClick={onOpenUsagePage}
            aria-label={
              remaining !== null
                ? `${item.label}: ${remaining}% remaining`
                : `${item.label}: usage limits`
            }
            className="group relative flex size-7 cursor-pointer items-center justify-center rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
        }
      >
        <svg
          viewBox="0 0 28 28"
          className="-rotate-90 pointer-events-none absolute inset-0 size-full transform-gpu"
          aria-hidden="true"
        >
          <circle
            cx="14"
            cy="14"
            r={radius}
            fill="none"
            className="stroke-muted-foreground/20"
            strokeWidth="2.25"
          />
          {remaining !== null ? (
            <circle
              cx="14"
              cy="14"
              r={radius}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
            />
          ) : null}
        </svg>
        <ProviderInstanceIcon
          driverKind={item.driver}
          displayName={item.label}
          accentColor={item.accentColor}
          acpRegistryIconUrl={item.acpRegistryIconUrl}
          size="compact"
          className="size-4"
          iconClassName="size-3.5 text-foreground/85 group-hover:text-foreground"
        />
      </PopoverTrigger>
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        sideOffset={8}
        padding="none"
        width="sm"
        className="w-72 text-left whitespace-normal"
      >
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <ProviderInstanceIcon
                driverKind={item.driver}
                displayName={item.label}
                accentColor={item.accentColor}
                acpRegistryIconUrl={item.acpRegistryIconUrl}
                size="compact"
                className="size-4"
                iconClassName="size-3.5 text-foreground"
              />
              <span className="truncate font-medium text-foreground text-xs">{item.label}</span>
              {accountPlan ? (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                  {accountPlan}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Refresh usage limits"
                disabled={isRefreshing}
                onClick={(event) => {
                  event.stopPropagation();
                  onRefresh();
                }}
              >
                <RefreshIcon size="sm" refreshing={isRefreshing} />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Open full Usage page"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenUsagePage();
                }}
              >
                <ExternalLinkIcon className="size-3" />
              </Button>
            </div>
          </div>

          {windows.length > 0 ? (
            <div className="flex flex-col gap-2.5 border-t border-border/60 pt-2">
              {windows.map((window) => (
                <DockWindowRow
                  key={`${window.kind}:${window.id}`}
                  driver={item.driver}
                  window={window}
                  color={barAccent}
                  now={now}
                />
              ))}
            </div>
          ) : (
            <div className="border-t border-border/60 pt-2 text-2xs text-muted-foreground">
              {item.unavailableNotice}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export function ProviderUsageDock() {
  const navigate = useNavigate();
  const isUsageRoute = useLocation({ select: (location) => location.pathname === "/usage" });
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const nowMinute = useNowMinute();
  const [refreshTickNow, setRefreshTickNow] = useState(() => Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const now = Math.max(Date.parse(`${nowMinute}:00Z`), refreshTickNow);

  const connectedEnvironmentIds = [...presentations]
    .filter(
      ([, presentation]) =>
        presentation.connection.phase === "connected" && presentation.serverConfig !== null,
    )
    .map(([environmentId]) => environmentId);
  const connectedKey = connectedEnvironmentIds.slice().sort().join(",");

  const refreshLimits = (automatic: boolean) =>
    settlePromise(() =>
      Promise.all(
        connectedEnvironmentIds.map((environmentId: EnvironmentId) =>
          refreshUsageLimits(
            environmentId,
            () => refreshProviders({ environmentId, input: {} }),
            automatic,
          ),
        ),
      ),
    ).then(() => {
      setRefreshTickNow(Date.now());
    });

  const handleManualRefresh = () => {
    if (connectedEnvironmentIds.length === 0 || isRefreshing) return;
    setIsRefreshing(true);
    void refreshLimits(false).finally(() => {
      setIsRefreshing(false);
    });
  };

  const autoRefresh = useEffectEvent(() => {
    void refreshLimits(true);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- probes usage limits automatically when connected environments become ready
  useEffect(() => {
    if (connectedKey) autoRefresh();
  }, [connectedKey]);

  if (isUsageRoute) return null;

  const items = buildProviderDockItems(presentations, now);
  if (items.length === 0) return null;

  return (
    <div
      data-provider-usage-dock=""
      role="region"
      aria-label="Connected providers usage"
      className="pointer-events-auto fixed right-3 bottom-3 z-40 flex items-center gap-1 rounded-full border border-border/60 bg-background/85 p-1 shadow-sm backdrop-blur-md transition-opacity"
    >
      {items.map((item) => (
        <ProviderUsageDockButton
          key={item.driver}
          item={item}
          now={now}
          isRefreshing={isRefreshing}
          onRefresh={handleManualRefresh}
          onOpenUsagePage={() => void navigate({ to: "/usage" })}
        />
      ))}
    </div>
  );
}
