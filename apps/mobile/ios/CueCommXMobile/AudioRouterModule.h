#import <React/RCTBridgeModule.h>

// Exposes a single method to override the iOS AVAudioSession output port
// without changing the audio category or mode (which would disrupt WebRTC).
@interface AudioRouterModule : NSObject <RCTBridgeModule>
@end
