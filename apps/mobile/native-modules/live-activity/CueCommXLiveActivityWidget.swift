import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Status Badge

@available(iOS 16.2, *)
private struct StatusBadge: View {
    let isTalking: Bool
    let isArmed: Bool

    private var label: String {
        if isTalking { return "TALKING" }
        if isArmed   { return "READY" }
        return "UNARMED"
    }
    private var color: Color {
        if isTalking { return .red }
        if isArmed   { return .green }
        return Color(white: 0.5)
    }
    private var icon: String {
        if isTalking { return "mic.fill" }
        if isArmed   { return "mic" }
        return "mic.slash"
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.caption2)
            Text(label).font(.caption2.bold())
        }
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(color.opacity(0.18))
        .clipShape(Capsule())
    }
}

// MARK: - Channel Chip

@available(iOS 16.2, *)
private struct ChannelChip: View {
    let name: String
    let active: Bool   // true = talk chip (colored), false = listen chip (neutral)

    var body: some View {
        Text(name)
            .font(.caption2)
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(active ? Color.blue.opacity(0.22) : Color.white.opacity(0.1))
            .foregroundStyle(active ? Color.blue : Color.white.opacity(0.75))
            .clipShape(Capsule())
    }
}

// MARK: - Talk Button

@available(iOS 16.2, *)
private struct TalkButton: View {
    let isTalking: Bool
    let isArmed: Bool

    var body: some View {
        Group {
            if #available(iOS 17.0, *) {
                Button(intent: ToggleTalkIntent()) { talkLabel }
                    .tint(isTalking ? .red : .blue)
                    .disabled(!isArmed)
            } else {
                talkLabel.foregroundStyle(isArmed ? .primary : .secondary)
            }
        }
    }

    private var talkLabel: some View {
        Label(
            isTalking ? "Stop" : "Talk",
            systemImage: isTalking ? "mic.slash.fill" : "mic.fill"
        )
        .font(.subheadline.bold())
    }
}

// MARK: - Lock Screen View

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<CueCommXLiveActivityAttributes>

    private var state: CueCommXLiveActivityAttributes.ContentState { context.state }
    private var attrs: CueCommXLiveActivityAttributes { context.attributes }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {

            // Row 1: App + server name + status badge
            HStack(alignment: .center, spacing: 8) {
                Image(systemName: "headphones")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text("CueCommX")
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                if !attrs.serverName.isEmpty {
                    Text("· \(attrs.serverName)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
                Spacer()
                StatusBadge(isTalking: state.isTalking, isArmed: state.isArmed)
            }

            // Row 2: User name + online count
            HStack(alignment: .center) {
                Label(attrs.userName, systemImage: "person.fill")
                    .font(.subheadline.bold())
                    .foregroundStyle(.primary)
                Spacer()
                if state.connectedUserCount > 0 {
                    Label("\(state.connectedUserCount) online", systemImage: "person.2.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            // Row 3: Talk channels
            if !state.talkChannelNames.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("TALK").font(.caption2.bold()).foregroundStyle(.secondary)
                    flowRow(state.talkChannelNames, active: true)
                }
            }

            // Row 4: Listen channels
            if !state.listenChannelNames.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("MONITOR").font(.caption2.bold()).foregroundStyle(.secondary)
                    flowRow(state.listenChannelNames, active: false)
                }
            }

            // Row 5: Active talkers from other users
            if !state.activeTalkers.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "waveform").font(.caption2).foregroundStyle(.red)
                    Text(talkerText).font(.caption2).foregroundStyle(.red).lineLimit(1)
                }
            }

            // Row 6: Talk button
            HStack {
                Spacer()
                if state.isArmed {
                    TalkButton(isTalking: state.isTalking, isArmed: state.isArmed)
                        .buttonStyle(.borderedProminent)
                } else {
                    Label("Unarmed", systemImage: "mic.slash")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    private var talkerText: String {
        let names = state.activeTalkers.prefix(3)
        let joined = names.joined(separator: ", ")
        let extra = state.activeTalkers.count > 3 ? " +\(state.activeTalkers.count - 3)" : ""
        return "\(joined)\(extra) talking"
    }

    @ViewBuilder
    private func flowRow(_ items: [String], active: Bool) -> some View {
        // Simple horizontal wrap using a fixed HStack (no LazyVGrid needed)
        HStack(spacing: 4) {
            ForEach(items.prefix(5), id: \.self) { name in
                ChannelChip(name: name, active: active)
            }
            if items.count > 5 {
                Text("+\(items.count - 5)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Widget

@available(iOS 16.2, *)
struct CueCommXLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CueCommXLiveActivityAttributes.self) { context in
            LockScreenView(context: context)
                .background(.black.opacity(0.35))
        } dynamicIsland: { context in
            let state = context.state
            let attrs = context.attributes

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Image(systemName: state.isTalking ? "mic.fill" : "mic")
                                .foregroundStyle(state.isTalking ? .red : .primary)
                            Text(state.isTalking ? "TALKING" : (state.isArmed ? "READY" : "UNARMED"))
                                .font(.caption.bold())
                                .foregroundStyle(state.isTalking ? .red : .primary)
                        }
                        Text(attrs.userName)
                            .font(.caption2).foregroundStyle(.secondary)
                        if !attrs.serverName.isEmpty {
                            Text(attrs.serverName)
                                .font(.caption2).foregroundStyle(.tertiary)
                        }
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
                    VStack(alignment: .leading, spacing: 6) {
                        if !state.talkChannelNames.isEmpty {
                            HStack(spacing: 4) {
                                Text("TALK:").font(.caption2.bold()).foregroundStyle(.secondary)
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 4) {
                                        ForEach(state.talkChannelNames, id: \.self) { ch in
                                            ChannelChip(name: ch, active: true)
                                        }
                                    }
                                }
                            }
                        }
                        if !state.activeTalkers.isEmpty {
                            HStack(spacing: 4) {
                                Image(systemName: "waveform").font(.caption2).foregroundStyle(.red)
                                Text(state.activeTalkers.prefix(3).joined(separator: ", ") + " talking")
                                    .font(.caption2).foregroundStyle(.red)
                            }
                        }
                        if state.connectedUserCount > 0 {
                            Label("\(state.connectedUserCount) online", systemImage: "person.2.fill")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top, 4)
                }
            } compactLeading: {
                Image(systemName: state.isTalking ? "mic.fill" : "mic")
                    .foregroundStyle(state.isTalking ? .red : .primary)
                    .padding(.leading, 4)
            } compactTrailing: {
                if state.isTalking {
                    Text("TALK").font(.caption2.bold()).foregroundStyle(.red).padding(.trailing, 4)
                } else {
                    Text("\(state.talkChannelNames.count)ch")
                        .font(.caption2).foregroundStyle(.secondary).padding(.trailing, 4)
                }
            } minimal: {
                Image(systemName: state.isTalking ? "mic.fill" : "mic")
                    .foregroundStyle(state.isTalking ? .red : .primary)
            }
        }
    }
}
