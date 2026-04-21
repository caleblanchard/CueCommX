import AppIntents

@available(iOS 17.0, *)
struct ToggleTalkIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Toggle Talk"
    static var description: IntentDescription = .init("Toggle the microphone talk state")

    func perform() async throws -> some IntentResult {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName("com.cuecommx.mobile.toggleTalk" as CFString),
            nil,
            nil,
            true
        )
        return .result()
    }
}
