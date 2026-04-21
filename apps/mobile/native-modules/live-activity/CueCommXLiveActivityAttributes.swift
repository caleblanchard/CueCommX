import ActivityKit

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
