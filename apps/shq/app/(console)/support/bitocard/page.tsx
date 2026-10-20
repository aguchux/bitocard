"use client";

import {
  Button,
  Card,
  ChatPanel,
  chatStatusLabels,
  errorMessage,
  Notice,
  PageHeader,
  QueryView,
  Skeleton,
} from "@bitocard/admin-ui";
import {
  chatFile,
  useAttachBitocardChatMutation,
  useBitocardChatQuery,
  useCloseBitocardChatMutation,
  useSendBitocardChatMutation,
} from "@bitocard/api-client/reseller";
import { isPlanRefusal, PlanRequired } from "@/components/plan-required";
import { ShqShell } from "@/components/shq-shell";

/**
 * Chat with BitoCard: any team member can ask, on a plan with priority support (otherwise the page says so and offers
 * the plans). The first message starts a chat; it is polled while open.
 */
export default function BitocardChatPage() {
  const first = useBitocardChatQuery(undefined, {
    skipPollingIfUnfocused: true,
  });
  const refused = isPlanRefusal(first.error) && !first.data;
  const query = useBitocardChatQuery(undefined, {
    pollingInterval: refused ? 0 : 3_000,
    skipPollingIfUnfocused: true,
  });
  const [send, sendState] = useSendBitocardChatMutation();
  const [close, closeState] = useCloseBitocardChatMutation();
  const [attach, attachState] = useAttachBitocardChatMutation();
  return (
    <ShqShell
      section="support"
      current="/support/bitocard"
      crumbs={[
        { label: "Support", href: "/support" },
        { label: "Chat with BitoCard" },
      ]}
    >
      <PageHeader
        title="Chat with BitoCard"
        description="Ask BitoCard anything about your account, your store or the API. For something to follow up over days, open a ticket instead."
      />
      {refused ? <PlanRequired error={first.error} /> : null}
      {refused ? null : (
        <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
          {({ chat }) => (
            <Card className="space-y-3 p-4 sm:p-5">
              {chat ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                  <span>{chatStatusLabels[chat.status]}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void close(chat.id)}
                    loading={closeState.isLoading}
                  >
                    End chat
                  </Button>
                </div>
              ) : (
                <Notice tone="blue">
                  Write your question below to start a chat. You are told when
                  BitoCard replies.
                </Notice>
              )}
              <ChatPanel
                messages={chat?.messages ?? []}
                side="reseller"
                onSend={async (body) =>
                  Boolean(
                    await send({ body })
                      .unwrap()
                      .catch(() => null),
                  )
                }
                onAttach={async (file, body) =>
                  Boolean(
                    await attach({ file, body })
                      .unwrap()
                      .catch(() => null),
                  )
                }
                loadFile={
                  chat
                    ? (file) =>
                        chatFile(
                          `/v1/support/bitocard-chat/${chat.id}/files/${file}`,
                        )
                    : undefined
                }
                error={
                  sendState.error
                    ? errorMessage(sendState.error)
                    : attachState.error
                      ? errorMessage(attachState.error)
                      : closeState.error
                        ? errorMessage(closeState.error)
                        : null
                }
                placeholder="Ask BitoCard"
              />
            </Card>
          )}
        </QueryView>
      )}
    </ShqShell>
  );
}
