import ExpoModulesCore
import ActivityKit

// CueCommXLiveActivityAttributes must match the definition in the Widget Extension.
// ActivityKit uses Codable serialization, so field names and types must be identical.
@available(iOS 16.2, *)
struct CueCommXLiveActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var isTalking: Bool
        var isArmed: Bool
        var activeChannelNames: [String]
        var talkingUserName: String?
    }

    var userName: String
}

public class CueCommXLiveActivityModule: Module {
    // Type-erased backing store: Swift forbids @available on stored properties.
    // The computed accessor below enforces the iOS 16.2+ guard at the call site.
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
                Task {
                    await self.currentActivity?.end(nil, dismissalPolicy: .immediate)
                }
            }
        }

        Function("startActivity") { (userName: String, channels: [String]) in
            guard #available(iOS 16.2, *) else { return }

            Task { @MainActor in
                if let existing = self.currentActivity {
                    await existing.end(nil, dismissalPolicy: .immediate)
                    self.currentActivity = nil
                }

                let attributes = CueCommXLiveActivityAttributes(userName: userName)
                let initialState = CueCommXLiveActivityAttributes.ContentState(
                    isTalking: false,
                    isArmed: true,
                    activeChannelNames: channels,
                    talkingUserName: nil
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

        Function("updateActivity") { (isTalking: Bool, isArmed: Bool, channels: [String], talkingUser: String?) in
            guard #available(iOS 16.2, *) else { return }
            guard let activity = self.currentActivity else { return }

            Task {
                let newState = CueCommXLiveActivityAttributes.ContentState(
                    isTalking: isTalking,
                    isArmed: isArmed,
                    activeChannelNames: channels,
                    talkingUserName: talkingUser
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
                await MainActor.run {
                    self.currentActivity = nil
                }
            }
        }
    }

    private func setupDarwinListener() {
        let notificationName = "com.cuecommx.mobile.toggleTalk" as CFString
        let center = CFNotificationCenterGetDarwinNotifyCenter()

        CFNotificationCenterAddObserver(
            center,
            Unmanaged.passUnretained(self).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer = observer else { return }
                let module = Unmanaged<CueCommXLiveActivityModule>.fromOpaque(observer).takeUnretainedValue()
                DispatchQueue.main.async {
                    module.sendEvent("onToggleTalk", [:])
                }
            },
            notificationName,
            nil,
            .deliverImmediately
        )
    }

    private func teardownDarwinListener() {
        let notificationName = "com.cuecommx.mobile.toggleTalk" as CFString
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterRemoveObserver(
            center,
            Unmanaged.passUnretained(self).toOpaque(),
            CFNotificationName(notificationName),
            nil
        )
    }
}
