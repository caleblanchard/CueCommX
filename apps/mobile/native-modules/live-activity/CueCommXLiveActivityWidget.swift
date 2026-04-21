import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Shared Views

@available(iOS 16.2, *)
private struct StatusBadge: View {
    let isTalking: Bool
    let isArmed: Bool

    var label: String {
        if isTalking { return "TALKING" }
        if isArmed   { return "READY" }
        return "UNARMED"
    }

    var color: Color {
        if isTalking { return .red }
        if isArmed   { return .green }
        return .secondary
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: isTalking ? "mic.fill" : (isArmed ? "mic" : "mic.slash"))
                .font(.caption2)
            Text(label)
                .font(.caption2.bold())
        }
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(color.opacity(0.15))
        .clipShape(Capsule())
    }
}

@available(iOS 16.2, *)
private struct TalkButton: View {
    let isTalking: Bool
    let isArmed: Bool

    var body: some View {
        Group {
            if #available(iOS 17.0, *) {
                Button(intent: ToggleTalkIntent()) {
                    talkLabel
                }
                .tint(isTalking ? .red : .blue)
                .disabled(!isArmed)
            } else {
                talkLabel
                    .foregroundStyle(isArmed ? .primary : .secondary)
            }
        }
    }

    private var talkLabel: some View {
        Label(
            isTalking ? "Stop" : "Talk",
            systemImage: isTalking ? "mic.slash.fill" : "mic.fill"
        )
        .font(.caption.bold())
    }
}

// MARK: - Lock Screen View

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<CueCommXLiveActivityAttributes>

    var state: CueCommXLiveActivityAttributes.ContentState { context.state }
    var attrs: CueCommXLiveActivityAttributes { context.attributes }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            // Left: all text info
            VStack(alignment: .leading, spacing: 5) {
                // Row 1: app label + status badge
                HStack(spacing: 6) {
                    Text("CueCommX")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    StatusBadge(isTalking: state.isTalking, isArmed: state.isArmed)
                }

                // Row 2: operator name
                HStack(spacing: 4) {
                    Image(systemName: "person.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(attrs.userName)
                        .font(.caption.bold())
                        .foregroundStyle(.primary)
                }

                // Row 3: active channels or talking-user name
                if let talkingUser = state.talkingUserName, state.isTalking {
                    HStack(spacing: 4) {
                        Image(systemName: "waveform")
                            .font(.caption2)
                            .foregroundStyle(.red)
                        Text(talkingUser)
                            .font(.caption2)
                            .foregroundStyle(.red)
                    }
                } else if !state.activeChannelNames.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "antenna.radiowaves.left.and.right")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(state.activeChannelNames.prefix(3).joined(separator: " · "))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }

            Spacer()

            // Right: talk button
            if state.isArmed {
                TalkButton(isTalking: state.isTalking, isArmed: state.isArmed)
                    .buttonStyle(.borderedProminent)
            } else {
                VStack(spacing: 4) {
                    Image(systemName: "mic.slash")
                        .font(.title3)
                        .foregroundStyle(.tertiary)
                    Text("Unarmed")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

// MARK: - Widget

@available(iOS 16.2, *)
struct CueCommXLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CueCommXLiveActivityAttributes.self) { context in
            LockScreenView(context: context)
                .background(.black.opacity(0.3))
        } dynamicIsland: { context in
            let state = context.state

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Image(systemName: state.isTalking ? "mic.fill" : "mic")
                                .foregroundStyle(state.isTalking ? .red : .primary)
                                .font(.subheadline)
                            Text(state.isTalking ? "TALKING" : (state.isArmed ? "READY" : "UNARMED"))
                                .font(.caption.bold())
                                .foregroundStyle(state.isTalking ? .red : .primary)
                        }
                        Text(context.attributes.userName)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.leading, 4)
                }

                DynamicIslandExpandedRegion(.trailing) {
                    if state.isArmed {
                        TalkButton(isTalking: state.isTalking, isArmed: state.isArmed)
                            .buttonStyle(.borderedProminent)
                            .padding(.trailing, 4)
                    }
                }

                DynamicIslandExpandedRegion(.bottom) {
                    if let talkingUser = state.talkingUserName, state.isTalking {
                        HStack(spacing: 4) {
                            Image(systemName: "waveform")
                                .font(.caption2)
                                .foregroundStyle(.red)
                            Text("\(talkingUser) is talking")
                                .font(.caption2)
                                .foregroundStyle(.red)
                        }
                        .padding(.top, 2)
                    } else if !state.activeChannelNames.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(state.activeChannelNames, id: \.self) { ch in
                                    Text(ch)
                                        .font(.caption2)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(.ultraThinMaterial)
                                        .clipShape(Capsule())
                                }
                            }
                        }
                        .padding(.top, 4)
                    }
                }
            } compactLeading: {
                Image(systemName: state.isTalking ? "mic.fill" : "mic")
                    .foregroundStyle(state.isTalking ? .red : .primary)
                    .padding(.leading, 4)
            } compactTrailing: {
                if state.isTalking {
                    Text("TALK")
                        .font(.caption2.bold())
                        .foregroundStyle(.red)
                        .padding(.trailing, 4)
                } else if !state.activeChannelNames.isEmpty {
                    Text("\(state.activeChannelNames.count)ch")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.trailing, 4)
                }
            } minimal: {
                Image(systemName: state.isTalking ? "mic.fill" : "mic")
                    .foregroundStyle(state.isTalking ? .red : .primary)
            }
        }
    }
}
