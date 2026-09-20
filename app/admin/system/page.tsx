import { AdminPageHeader, DataTable, DefinitionGrid, EmptyRow, Panel, cell } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { requireAdminPermission } from "@/features/admin/auth";
import { formatCount, formatDateTime, formatRelative, humanize } from "@/features/admin/format";
import { loadAiStatus, loadApplicationConfig, loadBillingStatus, loadProviderStatuses } from "@/features/admin/system";

export const dynamic = "force-dynamic";

function YesNo({ value, yes = "Yes", no = "No" }: { value: boolean; yes?: string; no?: string }) {
  return value ? <Badge tone="success">{yes}</Badge> : <Badge tone="warning">{no}</Badge>;
}

export default async function AdminSystemPage() {
  await requireAdminPermission("system.view");
  const [providers, ai, billing] = await Promise.all([loadProviderStatuses(), loadAiStatus(), loadBillingStatus()]);
  const config = loadApplicationConfig();
  const active = providers.find((provider) => provider.active);

  return (
    <div className="space-y-5">
      <AdminPageHeader title="System" description="Configuration health and diagnostics. Secrets are never displayed — only whether they are set." />

      <Panel id="providers" title="Question providers" description="QUESTION_PROVIDER chooses the provider for every exam and subject except those with a verified routing rule, listed under Coverage. Exactly one provider serves any single subject session, and there is no automatic fallback between providers." bodyClassName="p-0">
        {!active ? <p className="border-b border-slate-100 px-4 py-3 text-[12.5px] text-danger-700">QUESTION_PROVIDER is set to “{config.activeQuestionProvider}”, which this build does not implement. New sessions will fail to start.</p> : null}
        <DataTable label="Question providers" minWidth={1080}>
          <thead>
            <tr>
              <th scope="col" className={cell.th}>Provider</th>
              <th scope="col" className={cell.th}>State</th>
              <th scope="col" className={cell.th}>Configured</th>
              <th scope="col" className={cell.th}>Coverage</th>
              <th scope="col" className={cell.th}>Filters supported</th>
              <th scope="col" className={cell.th}>Last 24 hours</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.id}>
                <td className={cell.td}><span className="font-semibold text-slate-950">{provider.name}</span><div className="mono-number text-[11px] text-slate-500">{provider.id}</div></td>
                <td className={cell.td}>
                  {provider.active ? <Badge tone="brand" dot>Active</Badge> : provider.implemented ? <Badge tone="neutral">Available</Badge> : <Badge tone="neutral">Not implemented</Badge>}
                </td>
                <td className={`${cell.td} text-[11.5px]`}>
                  {provider.implemented ? <YesNo value={provider.configured} /> : "—"}
                  <div className="mt-1 text-slate-500">{provider.configurationNote}</div>
                </td>
                <td className={`${cell.td} text-[11.5px]`}>{provider.coverage.length ? provider.coverage.map((line) => <div key={line}>{line}</div>) : "—"}</td>
                <td className={`${cell.td} text-[11.5px]`}>
                  {provider.capabilities ? (["years", "topics", "difficulty", "passages", "assets", "explanations"] as const).filter((key) => provider.capabilities![key]).map((key) => humanize(key)).join(", ") || "None" : "—"}
                </td>
                <td className={`${cell.td} text-[11.5px]`}>
                  {provider.usage ? (
                    <>
                      <div>{formatCount(provider.usage.requests24h)} requests · {formatCount(provider.usage.failures24h)} failed · {formatCount(provider.usage.retries24h)} retried</div>
                      <div className="text-slate-500">Last success {formatRelative(provider.usage.lastSuccessAt)}{provider.usage.lastFailureAt ? ` · last failure ${formatRelative(provider.usage.lastFailureAt)}` : ""}</div>
                      {provider.usage.creditsRemaining != null ? <div className="text-slate-500">{formatCount(provider.usage.creditsRemaining)} credits remaining at last success</div> : null}
                    </>
                  ) : <span className="text-slate-500">Not tracked</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel id="ai" title="AI explanations">
          <DefinitionGrid
            items={[
              ["Enabled", <YesNo key="enabled" value={ai.enabled} yes="On" no="Off" />],
              ["Gemini key set", <YesNo key="key" value={ai.keyConfigured} />],
              ["Model", <span key="model" className="mono-number">{ai.model}</span>],
              ["Prompt version", <span key="prompt" className="mono-number">{ai.promptVersion}</span>],
              ["Generated, 7 days", formatCount(ai.last7d.generated)],
              ["Served from cache, 7 days", formatCount(ai.last7d.cacheHits)],
              ["Failed, 7 days", formatCount(ai.last7d.failed)],
            ]}
          />
          {ai.failureCategories.length ? (
            <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-[12px] text-slate-700">
              {ai.failureCategories.map((row) => <li key={row.category}><span className="mono-number font-semibold">{formatCount(row.count)}</span> {humanize(row.category)}</li>)}
            </ul>
          ) : null}
          {!ai.enabled ? <p className="mt-3 text-[11.5px] text-slate-500">Explanations turn on only when AI_EXPLANATIONS_ENABLED is true and a Gemini key is set on the server.</p> : null}
        </Panel>

        <Panel title="Application">
          <DefinitionGrid
            items={[
              ["Active question provider", <span key="provider" className="mono-number">{config.activeQuestionProvider}</span>],
              ["Public app URL set", <YesNo key="url" value={config.appUrlConfigured} />],
              ["Support WhatsApp number set", <YesNo key="wa" value={config.supportWhatsappConfigured} />],
            ]}
          />
          <p className="mt-3 text-[11.5px] text-slate-500">These are deployment settings. Change them in the hosting environment and redeploy; they are not editable here.</p>
        </Panel>
      </div>

      <Panel id="payments" title="Payments" bodyClassName="p-0">
        <div className="border-b border-slate-100 p-4">
          <DefinitionGrid
            columns={3}
            items={[
              ["Paystack secret key set", <YesNo key="secret" value={billing.configured} />],
              ["Paystack mode", billing.configured ? <Badge key="mode" tone={billing.environment === "live" ? "success" : "warning"}>{billing.environment === "live" ? "Live" : "Test"}</Badge> : "—"],
              ["Public key set", <YesNo key="public" value={billing.publicKeyConfigured} />],
            ]}
          />
        </div>
        <DataTable label="Recent Paystack webhook deliveries" minWidth={760}>
          <thead><tr><th scope="col" className={cell.th}>Event</th><th scope="col" className={cell.th}>Outcome</th><th scope="col" className={cell.th}>Detail</th><th scope="col" className={cell.th}>Received</th><th scope="col" className={cell.th}>Decided</th></tr></thead>
          <tbody>
            {billing.recentWebhooks.length ? billing.recentWebhooks.map((event, index) => (
              <tr key={`${event.receivedAt}-${index}`}>
                <td className={`${cell.td} mono-number text-[11.5px]`}>{event.eventType}</td>
                <td className={cell.td}><Badge tone={event.outcome === "applied" ? "success" : event.outcome === "rejected" ? "danger" : event.outcome === "received" ? "warning" : "neutral"}>{humanize(event.outcome)}</Badge></td>
                <td className={`${cell.td} max-w-[300px] text-[11.5px]`}>{event.detail ?? "—"}</td>
                <td className={`${cell.td} whitespace-nowrap`}>{formatDateTime(event.receivedAt)}</td>
                <td className={`${cell.td} whitespace-nowrap`}>{formatDateTime(event.processedAt, "Unfinished")}</td>
              </tr>
            )) : <EmptyRow colSpan={5}>No webhook deliveries recorded.</EmptyRow>}
          </tbody>
        </DataTable>
      </Panel>

      <p className="text-[11.5px] text-slate-500">No runtime feature switches are offered here. Provider choice, AI and payment mode are deployment decisions, so they cannot drift between server instances.</p>
    </div>
  );
}
