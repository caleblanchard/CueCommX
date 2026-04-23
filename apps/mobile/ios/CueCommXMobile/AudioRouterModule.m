#import "AudioRouterModule.h"
#import <AVFoundation/AVFoundation.h>

@interface AudioRouterModule ()
@property (nonatomic) BOOL desiredSpeakerOutput;
@property (nonatomic) BOOL hasDesiredOutput;
@end

@implementation AudioRouterModule

RCT_EXPORT_MODULE();

- (instancetype)init {
  if (self = [super init]) {
    [[NSNotificationCenter defaultCenter]
      addObserver:self
      selector:@selector(handleRouteChange:)
      name:AVAudioSessionRouteChangeNotification
      object:nil];
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)handleRouteChange:(NSNotification *)notification {
  if (!self.hasDesiredOutput) return;

  NSInteger reason = [notification.userInfo[AVAudioSessionRouteChangeReasonKey] integerValue];

  // AVAudioSessionRouteChangeReasonOverride (4) = caused by our own overrideOutputAudioPort call.
  // Skip to avoid a feedback loop.
  if (reason == AVAudioSessionRouteChangeReasonOverride) return;

  // AVAudioSessionRouteChangeReasonNewDeviceAvailable (1) /
  // AVAudioSessionRouteChangeReasonOldDeviceUnavailable (2) = user plugged in / removed
  // headphones. Don't override hardware-driven routing decisions.
  if (reason == AVAudioSessionRouteChangeReasonNewDeviceAvailable ||
      reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) return;

  // For all other reasons (CategoryChange, WakeFromSleep, RouteConfigurationChange, etc.)
  // — typically fired when WebRTC re-activates the AVAudioSession — re-apply our preference.
  dispatch_async(dispatch_get_main_queue(), ^{
    [self applyDesiredOutput];
  });
}

- (void)applyDesiredOutput {
  AVAudioSessionPortOverride portOverride = self.desiredSpeakerOutput
    ? AVAudioSessionPortOverrideSpeaker
    : AVAudioSessionPortOverrideNone;
  [[AVAudioSession sharedInstance] overrideOutputAudioPort:portOverride error:nil];
}

RCT_EXPORT_METHOD(setOutputToSpeaker:(BOOL)speaker
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  self.desiredSpeakerOutput = speaker;
  self.hasDesiredOutput = YES;

  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *error = nil;

  AVAudioSessionPortOverride portOverride = speaker
    ? AVAudioSessionPortOverrideSpeaker
    : AVAudioSessionPortOverrideNone;

  // The session may not be active yet; if so the override is a no-op but the
  // route-change observer will re-apply it once WebRTC activates the session.
  [session overrideOutputAudioPort:portOverride error:&error];

  resolve(nil);
}

RCT_EXPORT_METHOD(clearOutputPreference:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  self.hasDesiredOutput = NO;
  resolve(nil);
}

@end
