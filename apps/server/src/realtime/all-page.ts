import type { UserInfo } from "@cuecommx/protocol";

import { arraysEqual, sortIds } from "./arrays.js";
import type { StepBuilder } from "./steps.js";
import type {
  AllPageState,
  CoordinationSession,
  FeatureContext,
  OperatorSessionCoordinationResult,
} from "./types.js";

type AllPageNoticeMessage =
  | { type: "allpage:active"; payload: { userId: string; username: string } }
  | { type: "allpage:inactive"; payload: Record<string, never> };

export class AllPageFeature {
  private state: AllPageState | undefined;

  constructor(private readonly context: FeatureContext) {}

  snapshot(): { sessionToken: string; userId: string; username: string } | null {
    const current = this.state;
    return current
      ? { sessionToken: current.sessionToken, userId: current.userId, username: current.username }
      : null;
  }

  blocksTalkFor(sessionToken: string): boolean {
    return this.state !== undefined && this.state.sessionToken !== sessionToken;
  }

  start(session: CoordinationSession): OperatorSessionCoordinationResult {
    if (session.user.role !== "admin" && session.user.role !== "operator") {
      return this.context.reject("forbidden", "Only admins and operators can start All-Page.", session.sessionToken);
    }

    if (this.state) {
      return this.context.reject("conflict", "An All-Page broadcast is already active.", session.sessionToken);
    }

    const previousListenStates = new Map<string, string[]>();

    return this.context.accept((steps) => {
      for (const current of this.context.sessions.values()) {
        if (current.sessionToken === session.sessionToken) {
          continue;
        }

        if (current.state.talkChannelIds.length > 0) {
          current.state = {
            ...current.state,
            talkChannelIds: [],
            talking: false,
          };
          this.context.appendOperatorState(steps, current.sessionToken);
          this.context.appendMediaRefresh(steps, current.sessionToken, "all-page");
        }
      }

      this.state = {
        previousListenStates,
        sessionToken: session.sessionToken,
        userId: session.user.id,
        username: session.user.username,
      };

      const allTalkChannelIds = sortIds(
        session.user.channelPermissions
          .filter((permission) => permission.canTalk)
          .map((permission) => permission.channelId),
      );
      if (!arraysEqual(allTalkChannelIds, session.state.talkChannelIds)) {
        session.state = {
          ...session.state,
          talkChannelIds: allTalkChannelIds,
          talking: allTalkChannelIds.length > 0,
        };
        this.context.appendOperatorState(steps, session.sessionToken);
        this.context.appendMediaRefresh(steps, session.sessionToken, "all-page");
      }

      for (const current of this.context.sessions.values()) {
        if (current.sessionToken === session.sessionToken) {
          continue;
        }

        previousListenStates.set(current.sessionToken, [...current.state.listenChannelIds]);
        const allListenChannelIds = sortIds(
          new Set(
            current.user.channelPermissions
              .filter((permission) => permission.canListen)
              .map((permission) => permission.channelId),
          ),
        );
        const merged = sortIds(new Set([...current.state.listenChannelIds, ...allListenChannelIds]));

        if (!arraysEqual(merged, current.state.listenChannelIds)) {
          current.state = {
            ...current.state,
            listenChannelIds: merged,
          };
          this.context.appendMediaRefresh(steps, current.sessionToken, "all-page");
        }
      }

      this.appendNotice(
        steps,
        {
          type: "allpage:active",
          payload: {
            userId: session.user.id,
            username: session.user.username,
          },
        },
      );

      this.context.refreshProjections(steps);
      steps.push({
        adapter: "audit",
        eventType: "allpage:start",
        userId: session.user.id,
        username: session.user.username,
      });
      steps.push({
        adapter: "osc",
        kind: "all-page-start",
        username: session.user.username,
      });
    });
  }

  stop(session: CoordinationSession): OperatorSessionCoordinationResult {
    const allPage = this.state;

    if (!allPage) {
      return this.context.reject("invalid-state", "No All-Page broadcast is active.", session.sessionToken);
    }

    if (allPage.sessionToken !== session.sessionToken && session.user.role !== "admin") {
      return this.context.reject("forbidden", "Only the pager or an admin can stop All-Page.", session.sessionToken);
    }

    return this.context.accept((steps) => {
      const pager = this.context.sessions.get(allPage.sessionToken);
      if (pager) {
        pager.state = {
          ...pager.state,
          talkChannelIds: [],
          talking: false,
        };
        this.context.appendOperatorState(steps, pager.sessionToken);
        this.context.appendMediaRefresh(steps, pager.sessionToken, "all-page");
      }

      this.restoreListeners(allPage.previousListenStates, allPage.sessionToken, steps);
      this.state = undefined;

      this.appendNotice(steps, { type: "allpage:inactive", payload: {} });

      this.context.refreshProjections(steps);
      steps.push({
        adapter: "audit",
        eventType: "allpage:stop",
        userId: session.user.id,
        username: session.user.username,
      });
      steps.push({
        adapter: "osc",
        kind: "all-page-stop",
      });
    });
  }

  detach(sessionToken: string, steps: StepBuilder): void {
    const allPage = this.state;

    if (!allPage || allPage.sessionToken !== sessionToken) {
      return;
    }

    this.restoreListeners(allPage.previousListenStates, sessionToken, steps);
    this.state = undefined;

    this.appendNotice(steps, { type: "allpage:inactive", payload: {} }, sessionToken);
  }

  private appendNotice(
    steps: StepBuilder,
    message: AllPageNoticeMessage,
    excludeSessionToken?: string,
  ): void {
    for (const current of this.context.sessions.values()) {
      if (current.sessionToken === excludeSessionToken) {
        continue;
      }

      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: current.sessionToken,
        message,
      });
    }
  }

  private restoreListeners(
    previousListenStates: ReadonlyMap<string, string[]>,
    pagerSessionToken: string,
    steps: StepBuilder,
  ): void {
    for (const session of this.context.sessions.values()) {
      if (session.sessionToken === pagerSessionToken) {
        continue;
      }

      const restoredState = this.context.buildOperatorState(session.user, session.state);
      const priorListenChannelIds = previousListenStates.get(session.sessionToken);

      session.state = {
        ...restoredState,
        listenChannelIds: priorListenChannelIds
          ? this.sanitizeListenChannelIds(session.user, priorListenChannelIds)
          : restoredState.listenChannelIds,
      };
      this.context.appendOperatorState(steps, session.sessionToken);
      this.context.appendMediaRefresh(steps, session.sessionToken, "all-page");
    }
  }

  private sanitizeListenChannelIds(user: UserInfo, channelIds: readonly string[]): string[] {
    const allowedListenChannelIds = new Set(
      user.channelPermissions
        .filter((permission) => permission.canListen)
        .map((permission) => permission.channelId),
    );

    return sortIds(new Set(channelIds.filter((channelId) => allowedListenChannelIds.has(channelId))));
  }
}
