import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Shared Views

@available(iOS 16.2, *)
private struct MicIcon: View {
    let isTalking: Bool
    var body: some View {
        Image(systemName: isTalking ? "mic.fill" : "mic")
            .foregroundStyle(isTalking ? .red : .secondary)
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
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var talkLabel: some View {
        Label(isTalking ? "Stop Talk" : "Talk", systemImage: isTalking ? "mic.slash.fill" : "mic.fill")
            .font(.caption.bold())
    }
}

// MARK: - Lock Screen View

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<CueCommXLiveActivityAttributes>

    var state: CueCommXLiveActivityAttributes.ContentState { context.state }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    MicIcon(isTalking: state.isTalking)
                    Text(state.isTalking ? "TALKING" : (state.isArmed ? "READY" : "UNARMED"))
                        .font(.caption.bold())
                        .foregroundStyle(state.isTalking ? .red : (state.isArmed ? .primary : .secondary))
                }

                if let talkingUser = state.talkingUserName {
                    Text(talkingUser)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if !state.activeChannelNames.isEmpty {
                    Text(state.activeChannelNames.prefix(2).joined(separator: " · "))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            if state.isArmed {
                TalkButton(isTalking: state.isTalking, isArmed: state.isArmed)
                    .buttonStyle(.borderedProminent)
            } else {
                Text("Unarmed")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.black.opacity(0.4))
    }
}

// MARK: - Widget

@available(iOS 16.2, *)
struct CueCommXLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CueCommXLiveActivityAttributes.self) { context in
            LockScreenView(context: context)
        } dynamicIsland: { context in
            let state = context.state

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        MicIcon(isTalking: state.isTalking)
                            .font(.title3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(state.isTalking ? "TALKING" : "READY")
                                .font(.caption.bold())
                                .foregroundStyle(state.isTalking ? .red : .primary)
                            Text(context.attributes.userName)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                DynamicIslandExpandedRegion(.trailing) {
                    if state.isArmed {
                        TalkButton(isTalking: state.isTalking, isArmed: state.isArmed)
                            .buttonStyle(.borderedProminent)
                    }
                }

                DynamicIslandExpandedRegion(.bottom) {
                    if !state.activeChannelNames.isEmpty {
                        HStack(spacing: 8) {
                            ForEach(state.activeChannelNames.prefix(3), id: \.self) { ch in
                                Text(ch)
                                    .font(.caption2)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(.ultraThinMaterial)
                                    .clipShape(Capsule())
                            }
                            if state.activeChannelNames.count > 3 {
                                Text("+\(state.activeChannelNames.count - 3)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.top, 4)
                    }
                }
            } compactLeading: {
                MicIcon(isTalking: state.isTalking)
                    .padding(.leading, 4)
            } compactTrailing: {
                if state.isTalking {
                    Text("TALK")
                        .font(.caption2.bold())
                        .foregroundStyle(.red)
                        .padding(.trailing, 4)
                } else if !state.activeChannelNames.isEmpty {
                    Text("\(state.activeChannelNames.count)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.trailing, 4)
                }
            } minimal: {
                MicIcon(isTalking: state.isTalking)
            }
        }
    }
}
