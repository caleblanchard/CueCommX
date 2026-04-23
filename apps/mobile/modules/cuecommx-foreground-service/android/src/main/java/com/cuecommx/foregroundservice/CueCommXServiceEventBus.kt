package com.cuecommx.foregroundservice

/** Lightweight in-process event bus connecting the Service to the Expo Module. */
object CueCommXServiceEventBus {
  var onToggleTalk: (() -> Unit)? = null
}
