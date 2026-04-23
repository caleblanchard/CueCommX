package com.cuecommx.foregroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class CueCommXIntercomService : Service() {

  companion object {
    const val NOTIFICATION_ID = 8088
    const val CHANNEL_ID = "cuecommx_intercom"

    const val ACTION_START = "com.cuecommx.INTERCOM_START"
    const val ACTION_UPDATE = "com.cuecommx.INTERCOM_UPDATE"
    const val ACTION_STOP = "com.cuecommx.INTERCOM_STOP"
    const val ACTION_TOGGLE_TALK = "com.cuecommx.INTERCOM_TOGGLE_TALK"

    const val EXTRA_USER_NAME = "userName"
    const val EXTRA_SERVER_NAME = "serverName"
    const val EXTRA_IS_TALKING = "isTalking"
    const val EXTRA_IS_ARMED = "isArmed"
    const val EXTRA_TALK_CHANNELS = "talkChannelNames"
    const val EXTRA_LISTEN_CHANNELS = "listenChannelNames"
    const val EXTRA_ACTIVE_TALKERS = "activeTalkers"
    const val EXTRA_USER_COUNT = "connectedUserCount"
  }

  private var userName = ""
  private var serverName = "CueCommX"
  private var isTalking = false
  private var isArmed = false
  private var talkChannelNames: List<String> = emptyList()
  private var listenChannelNames: List<String> = emptyList()
  private var activeTalkers: List<String> = emptyList()
  private var connectedUserCount = 0

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        userName = intent.getStringExtra(EXTRA_USER_NAME) ?: ""
        serverName = intent.getStringExtra(EXTRA_SERVER_NAME) ?: "CueCommX"
        updateNotification()
      }
      ACTION_UPDATE -> {
        isTalking = intent.getBooleanExtra(EXTRA_IS_TALKING, false)
        isArmed = intent.getBooleanExtra(EXTRA_IS_ARMED, false)
        talkChannelNames = intent.getStringArrayListExtra(EXTRA_TALK_CHANNELS) ?: emptyList()
        listenChannelNames = intent.getStringArrayListExtra(EXTRA_LISTEN_CHANNELS) ?: emptyList()
        activeTalkers = intent.getStringArrayListExtra(EXTRA_ACTIVE_TALKERS) ?: emptyList()
        connectedUserCount = intent.getIntExtra(EXTRA_USER_COUNT, 0)
        updateNotification()
      }
      ACTION_TOGGLE_TALK -> {
        CueCommXServiceEventBus.onToggleTalk?.invoke()
      }
      ACTION_STOP -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
          @Suppress("DEPRECATION")
          stopForeground(true)
        }
        stopSelf()
        return START_NOT_STICKY
      }
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "CueCommX Intercom",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Active intercom session status and controls"
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  private fun updateNotification() {
    getSystemService(NotificationManager::class.java)
      .notify(NOTIFICATION_ID, buildNotification())
  }

  private fun buildNotification(): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val launchPi = PendingIntent.getActivity(
      this, 0, launchIntent ?: Intent(),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    // Notification action: Talk / Stop Talk — routes back through the service
    val toggleIntent = Intent(this, CueCommXIntercomService::class.java).apply {
      action = ACTION_TOGGLE_TALK
    }
    val togglePi = PendingIntent.getService(
      this, 1, toggleIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val title = if (isTalking) "🔴 Live — $serverName" else serverName
    val bigText = buildBigText()

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_notification_mic)
      .setContentTitle(title)
      .setContentText(buildContentLine())
      .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
      .setContentIntent(launchPi)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .addAction(
        if (isTalking) android.R.drawable.ic_menu_close_clear_cancel
        else R.drawable.ic_notification_mic,
        if (isTalking) "Stop Talk" else "Talk",
        togglePi
      )
      .build()
  }

  private fun buildContentLine(): String = when {
    isTalking && talkChannelNames.isNotEmpty() ->
      "Talking: ${talkChannelNames.joinToString(", ")}"
    isArmed && talkChannelNames.isNotEmpty() ->
      "Ready · ${talkChannelNames.joinToString(", ")}"
    else ->
      "Connected · $connectedUserCount online"
  }

  private fun buildBigText(): String {
    val lines = mutableListOf<String>()
    if (userName.isNotEmpty()) lines += "Signed in as $userName"
    if (talkChannelNames.isNotEmpty()) lines += "Talk: ${talkChannelNames.joinToString(", ")}"
    if (listenChannelNames.isNotEmpty()) lines += "Listen: ${listenChannelNames.joinToString(", ")}"
    if (activeTalkers.isNotEmpty()) lines += "On air: ${activeTalkers.joinToString(", ")}"
    lines += "$connectedUserCount user${if (connectedUserCount != 1) "s" else ""} online"
    return lines.joinToString("\n")
  }
}
