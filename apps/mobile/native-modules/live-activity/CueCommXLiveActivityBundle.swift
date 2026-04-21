import SwiftUI
import WidgetKit

@main
struct CueCommXLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.2, *) {
            CueCommXLiveActivityWidget()
        }
    }
}
