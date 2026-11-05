package com.qder.langhuan

import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // TauriActivity 把 handleBackNavigation 设为 false，于是系统 back 直接 finish()。
    // 实测（Android 17 / x86_64 WebView）finish 会走 wry 的 WebView 销毁，进程必崩：
    //   FORTIFY: pthread_mutex_lock called on a destroyed mutex
    //   Fatal signal 11 (SIGSEGV) in tid (Jit thread pool)
    // 笔记壳的语义也不该是「按返回就杀进程」：用户多半只是想回桌面，草案还在 IndexedDB，
    // 下次点图标应该秒回。所以 back 只把任务移到后台；真要退出用最近任务划掉。
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          moveTaskToBack(true)
        }
      }
    )
  }
}
