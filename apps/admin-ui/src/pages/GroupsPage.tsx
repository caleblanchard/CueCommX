import { type FormEvent } from "react";

import * as Separator from "@radix-ui/react-separator";
import {
  type AuthSuccessResponse,
  type ChannelInfo,
  type GroupInfo,
} from "@cuecommx/protocol";

import { Button } from "../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";
import { inputClassName } from "../lib/form-styles.js";

interface GroupsPageProps {
  session?: AuthSuccessResponse;
  channels: ChannelInfo[];
  groups: GroupInfo[];
  groupActionError?: string;
  groupDeletePendingId?: string;
  groupFormPending: boolean;
  editingGroupId?: string;
  groupName: string;
  groupChannelIds: string[];
  onGroupNameChange: (v: string) => void;
  onGroupChannelIdsChange: (channelIds: string[]) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onCancelEdit: () => void;
  onEditGroup: (group: GroupInfo) => void;
  onDeleteGroup: (group: GroupInfo) => void;
}

export function GroupsPage({
  session,
  channels,
  groups,
  groupActionError,
  groupDeletePendingId,
  groupFormPending,
  editingGroupId,
  groupName,
  groupChannelIds,
  onGroupNameChange,
  onGroupChannelIdsChange,
  onSubmit,
  onCancelEdit,
  onEditGroup,
  onDeleteGroup,
}: GroupsPageProps) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Groups</h1>
          <p className="text-sm text-muted-foreground">
            Organize channels into named groups to control what each crew member sees.
          </p>
        </div>

        {session ? (
          <Card className="h-fit">
            <CardHeader>
              <CardDescription>Group management</CardDescription>
              <CardTitle>
                {editingGroupId ? "Edit group" : "Create a group"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <form className="space-y-4" onSubmit={onSubmit}>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground" htmlFor="group-name">
                    Group name
                  </label>
                  <input
                    className={inputClassName}
                    id="group-name"
                    onChange={(event) => onGroupNameChange(event.target.value)}
                    placeholder="Sunday Morning"
                    value={groupName}
                  />
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Channels in group
                    </h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Select which channels appear when this group is active. Global channels always appear regardless.
                    </p>
                  </div>

                  <div className="grid gap-3">
                    {channels.map((channel) => (
                      <label
                        className="inline-flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground"
                        key={channel.id}
                      >
                        <input
                          checked={groupChannelIds.includes(channel.id)}
                          onChange={(event) =>
                            onGroupChannelIdsChange(
                              event.target.checked
                                ? [...groupChannelIds, channel.id]
                                : groupChannelIds.filter((id) => id !== channel.id),
                            )
                          }
                          type="checkbox"
                        />
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: channel.color }}
                        />
                        {channel.name}
                        {channel.isGlobal ? (
                          <span className="text-xs text-muted-foreground">(Global)</span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button disabled={groupFormPending} type="submit">
                    {groupFormPending
                      ? editingGroupId
                        ? "Saving..."
                        : "Creating..."
                      : editingGroupId
                        ? "Save group"
                        : "Create group"}
                  </Button>
                  {editingGroupId ? (
                    <Button onClick={onCancelEdit} type="button" variant="outline">
                      Cancel editing
                    </Button>
                  ) : null}
                </div>
              </form>

              {groupActionError ? (
                <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                  {groupActionError}
                </div>
              ) : null}

              {groups.length > 0 ? (
                <>
                  <Separator.Root
                    className="h-px w-full bg-border/60"
                    decorative
                    orientation="horizontal"
                  />

                  <div className="space-y-4">
                    {groups.map((group, index) => (
                      <div className="space-y-4" key={group.id}>
                        <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">{group.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {group.channelIds.length} channel{group.channelIds.length !== 1 ? "s" : ""}{" "}
                                • {group.channelIds
                                  .map((id) => channels.find((ch) => ch.id === id)?.name ?? id)
                                  .join(", ")}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                aria-label={`Edit ${group.name}`}
                                onClick={() => onEditGroup(group)}
                                type="button"
                                variant="outline"
                              >
                                Edit
                              </Button>
                              <Button
                                aria-label={`Delete ${group.name}`}
                                disabled={groupDeletePendingId === group.id}
                                onClick={() => onDeleteGroup(group)}
                                type="button"
                                variant="danger"
                              >
                                {groupDeletePendingId === group.id
                                  ? "Deleting..."
                                  : "Delete"}
                              </Button>
                            </div>
                          </div>
                        </div>

                        {index < groups.length - 1 ? (
                          <Separator.Root
                            className="h-px w-full bg-border/60"
                            decorative
                            orientation="horizontal"
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <div className="text-sm leading-6 text-muted-foreground">
            Sign in as admin to manage groups.
          </div>
        )}
      </div>
    </div>
  );
}
