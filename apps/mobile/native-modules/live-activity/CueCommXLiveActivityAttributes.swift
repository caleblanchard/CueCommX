import ActivityKit

struct CueCommXLiveActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var isTalking: Bool
        var isArmed: Bool
        var activeChannelNames: [String]
        var talkingUserName: String?
    }

    var userName: String
}
