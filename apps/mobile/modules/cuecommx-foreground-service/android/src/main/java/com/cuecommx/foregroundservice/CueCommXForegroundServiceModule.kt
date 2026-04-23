package com.cuecommx.foregroundservice

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CueCommXForegroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CueCommXForegroundService")

    Events("onToggleTalk")

    OnCreate {
      CueCommXServiceEventBus.onToggleTalk = {
        sendEvent("onToggleTalk")
      }
    }

    OnDestroy {
      CueCommXServiceEventBus.onToggleTalk = null
    }

    Function("startService") { userName: String, serverName: String ->
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(context, CueCommXIntercomService::class.java).apply {
        action = CueCommXIntercomService.ACTION_START
        putExtra(CueCommXIntercomService.EXTRA_USER_NAME, userName)
        putExtra(CueCommXIntercomService.EXTRA_SERVER_NAME, serverName)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    Function("updateService") { isTalking: Boolean, isArmed: Boolean,
        talkChannelNames: List<String>, listenChannelNames: List<String>,
        activeTalkers: List<String>, connectedUserCount: Int ->
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(context, CueCommXIntercomService::class.java).apply {
        action = CueCommXIntercomService.ACTION_UPDATE
        putExtra(CueCommXIntercomService.EXTRA_IS_TALKING, isTalking)
        putExtra(CueCommXIntercomService.EXTRA_IS_ARMED, isArmed)
        putStringArrayListExtra(CueCommXIntercomService.EXTRA_TALK_CHANNELS, ArrayList(talkChannelNames))
        putStringArrayListExtra(CueCommXIntercomService.EXTRA_LISTEN_CHANNELS, ArrayList(listenChannelNames))
        putStringArrayListExtra(CueCommXIntercomService.EXTRA_ACTIVE_TALKERS, ArrayList(activeTalkers))
        putExtra(CueCommXIntercomService.EXTRA_USER_COUNT, connectedUserCount)
      }
      context.startService(intent)
    }

    Function("stopService") {
      appContext.reactContext?.let { context ->
        val intent = Intent(context, CueCommXIntercomService::class.java).apply {
          action = CueCommXIntercomService.ACTION_STOP
        }
        context.startService(intent)
      }
    }
  }
}
