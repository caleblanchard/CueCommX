import { type FormEvent } from "react";

import * as Separator from "@radix-ui/react-separator";
import {
  type AdminDashboardUser,
  type AuthSuccessResponse,
  type ChannelInfo,
  type ChannelPermission,
  type GroupInfo,
  type ManagedUser,
  type UserRole,
} from "@cuecommx/protocol";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";
import { inputClassName, selectClassName } from "../lib/form-styles.js";

interface UsersPageProps {
  session?: AuthSuccessResponse;
  channels: ChannelInfo[];
  groups: GroupInfo[];
  users: AdminDashboardUser[];
  usersLoading: boolean;
  userActionError?: string;
  deletePendingId?: string;
  forceMutePendingId?: string;
  userFormPending: boolean;
  editingUserId?: string;
  userUsername: string;
  userPin: string;
  userRole: UserRole;
  clearUserPin: boolean;
  userPermissions: ChannelPermission[];
  userGroupIds: string[];
  onUsernameChange: (v: string) => void;
  onPinChange: (v: string) => void;
  onRoleChange: (v: UserRole) => void;
  onClearPinChange: (v: boolean) => void;
  onPermissionChange: (channelId: string, key: "canListen" | "canTalk", value: boolean) => void;
  onGroupIdsChange: (groupIds: string[]) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onCancelEdit: () => void;
  onEditUser: (user: ManagedUser) => void;
  onDeleteUser: (user: ManagedUser) => void;
  onForceMute: (user: AdminDashboardUser) => void;
  formatChannelSummary: (user: ManagedUser, channels: ChannelInfo[]) => string;
  formatLiveTalkSummary: (user: AdminDashboardUser, channels: ChannelInfo[]) => string;
}

export function UsersPage({
  session,
  channels,
  groups,
  users,
  usersLoading,
  userActionError,
  deletePendingId,
  forceMutePendingId,
  userFormPending,
  editingUserId,
  userUsername,
  userPin,
  userRole,
  clearUserPin,
  userPermissions,
  userGroupIds,
  onUsernameChange,
  onPinChange,
  onRoleChange,
  onClearPinChange,
  onPermissionChange,
  onGroupIdsChange,
  onSubmit,
  onCancelEdit,
  onEditUser,
  onDeleteUser,
  onForceMute,
  formatChannelSummary,
  formatLiveTalkSummary,
}: UsersPageProps) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground">
            Manage operators and assign channel access.
          </p>
        </div>

        {session ? (
          <Card>
            <CardHeader>
              <CardDescription>User management</CardDescription>
              <CardTitle>
                {editingUserId ? "Edit operator permissions" : "Create an operator"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <form className="space-y-5" onSubmit={onSubmit}>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground" htmlFor="user-name">
                      Display name
                    </label>
                    <input
                      className={inputClassName}
                      id="user-name"
                      onChange={(event) => onUsernameChange(event.target.value)}
                      placeholder="Front of House"
                      value={userUsername}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground" htmlFor="user-role">
                      Role
                    </label>
                    <select
                      className={selectClassName}
                      id="user-role"
                      onChange={(event) => onRoleChange(event.target.value as UserRole)}
                      value={userRole}
                    >
                      <option value="admin">Admin</option>
                      <option value="operator">Operator</option>
                      <option value="user">User</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground" htmlFor="user-pin">
                      {editingUserId ? "New PIN" : "PIN"}
                    </label>
                    <input
                      className={inputClassName}
                      id="user-pin"
                      onChange={(event) => onPinChange(event.target.value)}
                      placeholder={editingUserId ? "Leave blank to keep current PIN" : "Optional"}
                      type="password"
                      value={userPin}
                    />
                  </div>
                  {editingUserId ? (
                    <label className="mt-8 inline-flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground">
                      <input
                        checked={clearUserPin}
                        onChange={(event) => onClearPinChange(event.target.checked)}
                        type="checkbox"
                      />
                      Clear existing PIN
                    </label>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Channel permissions
                    </h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Assign only the channels this user should hear or transmit on.
                    </p>
                  </div>

                  <div className="grid gap-3">
                    {channels.map((channel) => {
                      const permission = userPermissions.find(
                        (entry) => entry.channelId === channel.id,
                      ) ?? {
                        channelId: channel.id,
                        canListen: false,
                        canTalk: false,
                      };

                      return (
                        <div
                          className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/35 p-4 sm:flex-row sm:items-center sm:justify-between"
                          key={channel.id}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              aria-hidden="true"
                              className="h-3.5 w-3.5 rounded-full"
                              style={{ backgroundColor: channel.color }}
                            />
                            <div>
                              <p className="font-medium text-foreground">{channel.name}</p>
                              <p className="text-sm text-muted-foreground">{channel.id}</p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-3 text-sm text-foreground">
                            <label className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-2">
                              <input
                                checked={permission.canListen}
                                onChange={(event) =>
                                  onPermissionChange(
                                    channel.id,
                                    "canListen",
                                    event.target.checked,
                                  )
                                }
                                type="checkbox"
                              />
                              Listen
                            </label>
                            <label className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-2">
                              <input
                                checked={permission.canTalk}
                                onChange={(event) =>
                                  onPermissionChange(
                                    channel.id,
                                    "canTalk",
                                    event.target.checked,
                                  )
                                }
                                type="checkbox"
                              />
                              Talk
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {groups.length > 0 ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Group assignments
                      </h3>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Users with no groups see all their permitted channels. Assigning groups limits visible channels to the active group plus global channels.
                      </p>
                    </div>

                    <div className="grid gap-3">
                      {groups.map((group) => (
                        <label
                          className="inline-flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground"
                          key={group.id}
                        >
                          <input
                            checked={userGroupIds.includes(group.id)}
                            onChange={(event) =>
                              onGroupIdsChange(
                                event.target.checked
                                  ? [...userGroupIds, group.id]
                                  : userGroupIds.filter((id) => id !== group.id),
                              )
                            }
                            type="checkbox"
                          />
                          {group.name}
                          <span className="text-muted-foreground">
                            ({group.channelIds.length} channel{group.channelIds.length !== 1 ? "s" : ""})
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <Button disabled={userFormPending} type="submit">
                    {userFormPending
                      ? editingUserId
                        ? "Saving..."
                        : "Creating..."
                      : editingUserId
                        ? "Save changes"
                        : "Create user"}
                  </Button>
                  {editingUserId ? (
                    <Button onClick={onCancelEdit} type="button" variant="outline">
                      Cancel editing
                    </Button>
                  ) : null}
                </div>
              </form>

              {userActionError ? (
                <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                  {userActionError}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription>User roster</CardDescription>
            <CardTitle>Operators and admins</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {session ? (
              usersLoading ? (
                <div className="text-sm text-muted-foreground">Loading users...</div>
              ) : users.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No users have been created yet.
                </div>
              ) : (
                users.map((user, index) => (
                  <div className="space-y-4" key={user.id}>
                    <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-3">
                            <p className="text-lg font-semibold text-foreground">
                              {user.username}
                            </p>
                            <Badge variant={user.online ? "success" : "neutral"}>
                              {user.online ? "Online" : "Offline"}
                            </Badge>
                            <Badge variant={user.talking ? "warning" : "neutral"}>
                              {user.talking ? "Talking" : "Standing by"}
                            </Badge>
                            <Badge variant={user.role === "admin" ? "accent" : "neutral"}>
                              {user.role}
                            </Badge>
                            {user.online && user.connectionQuality ? (
                              <Badge
                                variant={
                                  user.connectionQuality.grade === "poor"
                                    ? "danger"
                                    : user.connectionQuality.grade === "fair"
                                      ? "warning"
                                      : "success"
                                }
                              >
                                {user.connectionQuality.grade === "excellent"
                                  ? "🟢"
                                  : user.connectionQuality.grade === "good"
                                    ? "🟢"
                                    : user.connectionQuality.grade === "fair"
                                      ? "🟡"
                                      : "🔴"}{" "}
                                {user.connectionQuality.roundTripTimeMs}ms
                              </Badge>
                            ) : null}
                            {user.preflightStatus === "passed" ? (
                              <Badge variant="success">✓ Audio OK</Badge>
                            ) : user.preflightStatus === "failed" ? (
                              <Badge variant="danger">✗ Audio fail</Badge>
                            ) : null}
                          </div>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {formatChannelSummary(user, channels)}
                          </p>
                          <p
                            className={`text-sm leading-6 ${
                              user.talking ? "text-warning" : "text-muted-foreground"
                            }`}
                          >
                            {formatLiveTalkSummary(user, channels)}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            aria-label={`Force-mute ${user.username}`}
                            disabled={
                              forceMutePendingId === user.id ||
                              !user.online ||
                              !user.talking
                            }
                            onClick={() => onForceMute(user)}
                            type="button"
                            variant="secondary"
                          >
                            {forceMutePendingId === user.id
                              ? "Muting..."
                              : "Force-mute"}
                          </Button>
                          <Button
                            aria-label={`Edit ${user.username}`}
                            onClick={() => onEditUser(user)}
                            type="button"
                            variant="outline"
                          >
                            Edit
                          </Button>
                          <Button
                            aria-label={`Delete ${user.username}`}
                            disabled={
                              deletePendingId === user.id ||
                              session?.user.id === user.id
                            }
                            onClick={() => onDeleteUser(user)}
                            type="button"
                            variant="danger"
                          >
                            {deletePendingId === user.id ? "Deleting..." : "Delete"}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {index < users.length - 1 ? (
                      <Separator.Root
                        className="h-px w-full bg-border/60"
                        decorative
                        orientation="horizontal"
                      />
                    ) : null}
                  </div>
                ))
              )
            ) : (
              <div className="text-sm leading-6 text-muted-foreground">
                Sign in as an admin to manage the local roster.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
