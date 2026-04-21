import ExpoModulesCore
import ActivityKit

// Must exactly match CueCommXLiveActivityAttributes in the Widget Extension.
// ActivityKit serializes ContentState via Codable — field names and types must be identical.
@available(iOS 16.2, *)
struct CueCommXLiveActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var isTalking: Bool
        var isArmed: Bool
        var talkChannelNames: [String]
        var listenChannelNames: [String]
        var activeTalkers: [String]
        var connectedUserCount: Int
    }

    var userName: String
    var serverName: String
}

public class CueCommXLiveActivityModule: Module {
    private var _currentActivity: Any?

    @available(iOS 16.2, *)
    private var currentActivity: Activity<CueCommXLiveActivityAttributes>? {
        get { _currentActivity as? Activity<CueCommXLiveActivityAttributes> }
        set { _currentActivity = newValue }
    }

    public func definition() -> ModuleDefinition {
        Name("CueCommXLiveActivity")
        Events("onToggleTalk")

        OnCreate {
            self.setupDarwinListener()
        }

        OnDestroy {
            self.teardownDarwinListener()
            if #available(iOS 16.2, *) {
                Task { await self.currentActivity?.end(nil, dismissalPolicy: .immediate) }
            }
        }

        Function("startActivity") { (userName: String, serverName: String) in
            guard #available(iOS 16.2, *) else { return }

            Task { @MainActor in
                if let existing = self.currentActivity {
                    await existing.end(nil, dismissalPolicy: .immediate)
                    self.currentActivity = nil
                }

                let attributes = CueCommXLiveActivityAttributes(
                    userName: userName,
                    serverName: serverName
                )
                let initialState = CueCommXLiveActivityAttributes.ContentState(
                    isTalking: false,
                    isArmed: true,
                    talkChannelNames: [],
                    listenChannelNames: [],
                    activeTalkers: [],
                    connectedUserCount: 0
                )

                do {
                    let content = ActivityContent(state: initialState, staleDate: nil)
                    self.currentActivity = try Activity.request(
                        attributes: attributes,
                        content: content,
                        pushType: nil
                    )
                } catch {
                    print("[CueCommXLiveActivity] Failed to start: \(error.localizedDescription)")
                }
            }
        }

        Function("updateActivity") { (
            isTalking: Bool,
            isArmed: Bool,
            talkChannelNames: [String],
            listenChannelNames: [String],
            activeTalkers: [String],
            connectedUserCount: Int
        ) in
            guard #available(iOS 16.2, *) else { return }
            guard let activity = self.currentActivity else { return }

            Task {
                let newState = CueCommXLiveActivityAttributes.ContentState(
                    isTalking: isTalking,
                    isArmed: isArmed,
                    talkChannelNames: talkChannelNames,
                    listenChannelNames: listenChannelNames,
                    activeTalkers: activeTalkers,
                    connectedUserCount: connectedUserCount
                )
                let content = ActivityContent(state: newState, staleDate: nil)
                await activity.update(content)
            }
        }

        Function("endActivity") {
            guard #available(iOS 16.2, *) else { return }
            guard let activity = self.currentActivity else { return }

            Task {
                await activity.end(nil, dismissalPolicy: .immediate)
                await MainActor.run { self.currentActivity = nil }
            }
        }
    }

    private func setupDarwinListener() {
        let notificationName = "com.cuecommx.mobile.toggleTalk" as CFString
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer = observer else { return }
                let module = Unmanaged<CueCommXLiveActivityModule>.fromOpaque(observer).takeUnretainedValue()
                DispatchQueue.main.async { module.sendEvent("onToggleTalk", [:]) }
            },
            notificationName,
            nil,
            .deliverImmediately
        )
    }

    private func teardownDarwinListener() {
        let notificationName = "com.cuecommx.mobile.toggleTalk" as CFString
        CFNotificationCenterRemoveObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            CFNotificationName(notificationName),
            nil
        )
    }
}
