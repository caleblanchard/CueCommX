#import "AudioRouterModule.h"
#import <AVFoundation/AVFoundation.h>

@implementation AudioRouterModule

RCT_EXPORT_MODULE();

// Override the AVAudioSession output port without touching the audio category
// or mode. This avoids disrupting WebRTC's internal audio session management
// while still routing audio to the speaker or earpiece.
RCT_EXPORT_METHOD(setOutputToSpeaker:(BOOL)speaker
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *error = nil;

  AVAudioSessionPortOverride portOverride = speaker
    ? AVAudioSessionPortOverrideSpeaker
    : AVAudioSessionPortOverrideNone;

  BOOL success = [session overrideOutputAudioPort:portOverride error:&error];

  if (!success || error) {
    reject(@"audio_route_error",
           error.localizedDescription ?: @"Failed to override output port",
           error);
  } else {
    resolve(nil);
  }
}

@end
