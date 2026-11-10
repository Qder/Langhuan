package com.qder.langhuan

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

@InvokeArg
class SafWriteTextArgs {
  lateinit var path: String
  lateinit var content: String
}

@InvokeArg
class SafWriteBytesArgs {
  lateinit var path: String
  lateinit var base64: String
}

/**
 * Storage Access Framework: persist a user-picked tree, then read/write notes.
 *
 * WebView showDirectoryPicker NPEs on this shell; this is the Android-only
 * replacement used by 本地文件夹同步.
 *
 * Registered from Rust via register_android_plugin("com.qder.langhuan", "SafPlugin").
 */
@TauriPlugin
class SafPlugin(private val activity: Activity) : Plugin(activity) {
  private val prefs
    get() = activity.getSharedPreferences("langhuan_saf", Activity.MODE_PRIVATE)

  @Command
  fun pickTree(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
    }
    startActivityForResult(invoke, intent, "onPickTree")
  }

  @ActivityCallback
  fun onPickTree(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) {
      invoke.reject("已取消选择文件夹")
      return
    }
    val uri = result.data?.data
    if (uri == null) {
      invoke.reject("未选择文件夹")
      return
    }
    try {
      val takeFlags =
        (result.data?.flags ?: 0) and
          (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      val flags =
        if (takeFlags != 0) takeFlags
        else Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      activity.contentResolver.takePersistableUriPermission(uri, flags)
    } catch (_: SecurityException) {
      // Some providers still allow the session; keep going and report writable below.
    }
    val doc = DocumentFile.fromTreeUri(activity, uri)
    val name = doc?.name ?: "文件夹"
    prefs.edit()
      .putString(KEY_URI, uri.toString())
      .putString(KEY_NAME, name)
      .apply()
    invoke.resolve(boundObject(true, uri.toString(), name, doc?.canWrite() == true))
  }

  @Command
  fun getBound(invoke: Invoke) {
    val uriStr = prefs.getString(KEY_URI, null)
    if (uriStr.isNullOrBlank()) {
      invoke.resolve(boundObject(false, "", "", false))
      return
    }
    val uri = Uri.parse(uriStr)
    val doc = DocumentFile.fromTreeUri(activity, uri)
    val name = prefs.getString(KEY_NAME, null) ?: doc?.name ?: "文件夹"
    val writable = doc != null && doc.canRead()
    invoke.resolve(boundObject(true, uriStr, name, writable && doc?.canWrite() == true))
  }

  @Command
  fun unbind(invoke: Invoke) {
    val uriStr = prefs.getString(KEY_URI, null)
    if (!uriStr.isNullOrBlank()) {
      try {
        val uri = Uri.parse(uriStr)
        activity.contentResolver.releasePersistableUriPermission(
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
      } catch (_: Exception) {
        /* already gone */
      }
    }
    prefs.edit().remove(KEY_URI).remove(KEY_NAME).apply()
    invoke.resolve()
  }

  @Command
  fun scanTree(invoke: Invoke) {
    Thread {
      try {
        val root = requireRoot()
        val docs = JSArray()
        val assets = JSArray()
        var truncated = false
        var skipped = 0
        var fileCount = 0
        var totalBytes = 0L
        data class AssetCand(val path: String, val file: DocumentFile, val size: Long, val lowerName: String)
        val assetCands = mutableListOf<AssetCand>()
        val docTexts = mutableListOf<Pair<String, String>>()

        fun walk(dir: DocumentFile, prefix: String, depth: Int) {
          if (truncated || depth > MAX_DEPTH) return
          val children = dir.listFiles() ?: return
          for (child in children) {
            if (truncated) return
            val name = child.name ?: continue
            if (shouldIgnore(name)) {
              skipped += 1
              continue
            }
            val path = if (prefix.isEmpty()) name else "$prefix/$name"
            if (child.isDirectory) {
              walk(child, path, depth + 1)
              continue
            }
            if (!child.isFile) continue
            fileCount += 1
            if (fileCount > MAX_FILES) {
              truncated = true
              return
            }
            val size = child.length()
            val lower = name.lowercase()
            when {
              isTextNote(lower) -> {
                if (size > MAX_FILE_BYTES) {
                  skipped += 1
                  continue
                }
                if (totalBytes + size > MAX_TOTAL_BYTES) {
                  truncated = true
                  return
                }
                val text = readUtf8(child)
                totalBytes += size
                val item = JSObject()
                item.put("path", path)
                item.put("content", text)
                item.put("mtime", child.lastModified())
                item.put("size", size)
                docs.put(item)
                docTexts.add(path to text)
              }
              isImage(lower) || isPdf(lower) -> {
                assetCands.add(AssetCand(path, child, size, lower))
              }
              else -> skipped += 1
            }
          }
        }

        walk(root, "", 0)
        for (cand in assetCands.sortedBy { it.path }) {
          if (truncated) {
            skipped += 1
            continue
          }
          if (isPdf(cand.lowerName) && !isReasonableAssetDir(cand.path) && !mentionedIn(docTexts, cand.path)) {
            skipped += 1
            continue
          }
          if (cand.size > MAX_FILE_BYTES) {
            skipped += 1
            continue
          }
          if (totalBytes + cand.size > MAX_TOTAL_BYTES) {
            truncated = true
            skipped += 1
            continue
          }
          val bytes = readBytes(cand.file)
          totalBytes += bytes.size.toLong()
          val item = JSObject()
          item.put("path", cand.path)
          item.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
          item.put("mime", mimeForAsset(cand.lowerName))
          item.put("mtime", cand.file.lastModified())
          item.put("size", bytes.size.toLong())
          assets.put(item)
        }
        val out = JSObject()
        out.put("docs", docs)
        out.put("assets", assets)
        out.put("truncated", truncated)
        out.put("skipped", skipped)
        activity.runOnUiThread { invoke.resolve(out) }
      } catch (ex: Exception) {
        activity.runOnUiThread { invoke.reject(ex.message ?: "读取文件夹失败") }
      }
    }.start()
  }


  /**
   * One-shot project folder pick + text scan for 读码.
   * Does not overwrite the 藏书阁 tree URI, and does not write the project
   * into content/. Temporary persistable permission is released after scan.
   */
  @Command
  fun pickAndScanProject(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }
    startActivityForResult(invoke, intent, "onPickProject")
  }

  @ActivityCallback
  fun onPickProject(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) {
      invoke.reject("已取消选择文件夹")
      return
    }
    val uri = result.data?.data
    if (uri == null) {
      invoke.reject("未选择文件夹")
      return
    }
    Thread {
      var taken = false
      try {
        try {
          activity.contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION
          )
          taken = true
        } catch (_: SecurityException) {
          /* session grant may still be enough to scan */
        }
        val doc = DocumentFile.fromTreeUri(activity, uri)
          ?: throw IllegalStateException("无法打开所选文件夹")
        if (!doc.canRead()) {
          throw IllegalStateException("没有读取权限，请重新选择文件夹")
        }
        val out = scanProjectTree(doc)
        activity.runOnUiThread { invoke.resolve(out) }
      } catch (ex: Exception) {
        activity.runOnUiThread { invoke.reject(ex.message ?: "读取文件夹失败") }
      } finally {
        if (taken) {
          try {
            activity.contentResolver.releasePersistableUriPermission(
              uri,
              Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
          } catch (_: Exception) {
            /* leave unusable grants; never write 藏书阁 KEY_URI */
          }
        }
      }
    }.start()
  }

  @Command
  fun writeText(invoke: Invoke) {
    val args = invoke.parseArgs(SafWriteTextArgs::class.java)
    Thread {
      try {
        writeBytes(requireRoot(), args.path, args.content.toByteArray(StandardCharsets.UTF_8))
        activity.runOnUiThread { invoke.resolve() }
      } catch (ex: Exception) {
        activity.runOnUiThread { invoke.reject(ex.message ?: "写入失败") }
      }
    }.start()
  }

  @Command
  fun writeBytes(invoke: Invoke) {
    val args = invoke.parseArgs(SafWriteBytesArgs::class.java)
    Thread {
      try {
        val raw = Base64.decode(args.base64, Base64.DEFAULT)
        writeBytes(requireRoot(), args.path, raw)
        activity.runOnUiThread { invoke.resolve() }
      } catch (ex: Exception) {
        activity.runOnUiThread { invoke.reject(ex.message ?: "写入失败") }
      }
    }.start()
  }

  private fun boundObject(bound: Boolean, uri: String, name: String, writable: Boolean): JSObject {
    val out = JSObject()
    out.put("bound", bound)
    out.put("uri", uri)
    out.put("name", name)
    out.put("writable", writable)
    return out
  }

  private fun scanProjectTree(root: DocumentFile): JSObject {
    val files = JSArray()
    val skipped = JSArray()
    var truncated = false
    var kept = 0
    var totalBytes = 0L

    fun skip(path: String, reason: String) {
      val item = JSObject()
      item.put("path", path)
      item.put("reason", reason)
      skipped.put(item)
    }

    fun hasNul(bytes: ByteArray): Boolean {
      val n = minOf(bytes.size, 8192)
      for (i in 0 until n) {
        if (bytes[i] == 0.toByte()) return true
      }
      return false
    }

    fun walk(dir: DocumentFile, prefix: String, depth: Int) {
      if (truncated) return
      if (depth > MAX_PROJECT_DEPTH) {
        if (prefix.isNotEmpty()) skip(prefix, "目录嵌套过深")
        return
      }
      val children = dir.listFiles() ?: return
      for (child in children) {
        if (truncated) return
        val name = child.name ?: continue
        val path = if (prefix.isEmpty()) name else "$prefix/$name"
        if (shouldIgnoreProject(name)) {
          skip(path, "忽略目录或文件规则")
          continue
        }
        if (child.isDirectory) {
          walk(child, path, depth + 1)
          continue
        }
        if (!child.isFile) continue
        if (!isProjectText(name)) {
          skip(path, "非文本文件类型")
          continue
        }
        val size = child.length()
        if (size > MAX_PROJECT_FILE_BYTES) {
          skip(path, "单文件超过 2 MiB 文本限制")
          continue
        }
        if (kept >= MAX_PROJECT_FILES) {
          truncated = true
          skip(path, "超过工程文件数量上限（3000）")
          continue
        }
        if (totalBytes + size > MAX_PROJECT_TOTAL_BYTES) {
          truncated = true
          skip(path, "超过工程合计 40 MiB 文本限制")
          continue
        }
        val bytes = try {
          readBytes(child)
        } catch (ex: Exception) {
          skip(path, "读取失败")
          continue
        }
        if (hasNul(bytes)) {
          skip(path, "正文含 NUL，判为二进制")
          continue
        }
        val text = String(bytes, StandardCharsets.UTF_8)
        val item = JSObject()
        item.put("path", path)
        item.put("content", text)
        files.put(item)
        kept += 1
        totalBytes += bytes.size.toLong()
      }
    }

    walk(root, "", 0)
    val out = JSObject()
    out.put("name", root.name ?: "工程")
    out.put("files", files)
    out.put("skipped", skipped)
    out.put("truncated", truncated)
    return out
  }

  private fun requireRoot(): DocumentFile {
    val uriStr = prefs.getString(KEY_URI, null)
      ?: throw IllegalStateException("尚未绑定文件夹")
    val doc = DocumentFile.fromTreeUri(activity, Uri.parse(uriStr))
      ?: throw IllegalStateException("绑定已失效，请重新选择文件夹")
    if (!doc.canRead()) {
      throw IllegalStateException("没有读取权限，请重新选择文件夹")
    }
    return doc
  }

  private fun writeBytes(root: DocumentFile, relPath: String, data: ByteArray) {
    val parts = sanitizePath(relPath)
    if (parts.isEmpty()) throw IllegalArgumentException("路径无效")
    var dir = root
    for (i in 0 until parts.size - 1) {
      val name = parts[i]
      var next = dir.findFile(name)
      if (next == null || !next.isDirectory) {
        next = dir.createDirectory(name)
          ?: throw IllegalStateException("无法创建目录 $name")
      }
      dir = next
    }
    val fileName = parts.last()
    var file = dir.findFile(fileName)
    if (file != null && file.isDirectory) {
      throw IllegalStateException("$fileName 已是文件夹")
    }
    if (file == null) {
      file = dir.createFile("application/octet-stream", fileName)
        ?: throw IllegalStateException("无法创建文件 $fileName")
    }
    val stream = activity.contentResolver.openOutputStream(file.uri, "w")
      ?: throw IllegalStateException("无法打开 $fileName")
    stream.use { it.write(data) }
  }

  private fun readUtf8(file: DocumentFile): String {
    return String(readBytes(file), StandardCharsets.UTF_8)
  }

  private fun readBytes(file: DocumentFile): ByteArray {
    val stream = activity.contentResolver.openInputStream(file.uri)
      ?: throw IllegalStateException("无法读取 ${file.name}")
    stream.use { input ->
      val out = ByteArrayOutputStream()
      val buf = ByteArray(16 * 1024)
      while (true) {
        val n = input.read(buf)
        if (n <= 0) break
        out.write(buf, 0, n)
      }
      return out.toByteArray()
    }
  }

  companion object {
    private const val KEY_URI = "treeUri"
    private const val KEY_NAME = "treeName"
    private const val MAX_DEPTH = 20
    private const val MAX_FILES = 2000
    private const val MAX_FILE_BYTES = 8L * 1024 * 1024
    private const val MAX_TOTAL_BYTES = 64L * 1024 * 1024

    private val IGNORED = setOf(
      "__MACOSX",
      ".DS_Store",
      "Thumbs.db",
      "node_modules",
      ".git",
      ".svn",
      ".hg",
      ".langhuan"
    )

    fun shouldIgnore(name: String): Boolean {
      if (name.isEmpty()) return true
      if (IGNORED.contains(name)) return true
      if (name.startsWith(".") && name != ".gitignore") return true
      return false
    }

    fun isTextNote(lowerName: String): Boolean {
      return lowerName.endsWith(".md") ||
        lowerName.endsWith(".html") ||
        lowerName.endsWith(".txt") ||
        lowerName.endsWith(".svg")
    }

    fun isImage(lowerName: String): Boolean {
      return lowerName.endsWith(".png") ||
        lowerName.endsWith(".jpg") ||
        lowerName.endsWith(".jpeg") ||
        lowerName.endsWith(".gif") ||
        lowerName.endsWith(".webp") ||
        lowerName.endsWith(".bmp") ||
        lowerName.endsWith(".avif") ||
        lowerName.endsWith(".ico")
    }

    fun isPdf(lowerName: String): Boolean {
      return lowerName.endsWith(".pdf")
    }

    fun isReasonableAssetDir(path: String): Boolean {
      val lower = "/$path/".lowercase()
      return lower.contains("/assets/") ||
        lower.contains("/figs/") ||
        lower.contains("/images/") ||
        lower.contains("/img/") ||
        lower.contains("/attachments/") ||
        lower.contains("/static/") ||
        lower.contains("/media/")
    }

    fun mentionedIn(docs: List<Pair<String, String>>, assetPath: String): Boolean {
      val base = assetPath.substringAfterLast('/')
      val needles = listOf(assetPath, "./$assetPath", base)
      return docs.any { (_, content) -> needles.any { n -> n.isNotEmpty() && content.contains(n) } }
    }

    fun mimeForAsset(lowerName: String): String {
      return when {
        lowerName.endsWith(".png") -> "image/png"
        lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") -> "image/jpeg"
        lowerName.endsWith(".gif") -> "image/gif"
        lowerName.endsWith(".webp") -> "image/webp"
        lowerName.endsWith(".bmp") -> "image/bmp"
        lowerName.endsWith(".avif") -> "image/avif"
        lowerName.endsWith(".ico") -> "image/x-icon"
        lowerName.endsWith(".pdf") -> "application/pdf"
        else -> "application/octet-stream"
      }
    }

    fun mimeForImage(lowerName: String): String = mimeForAsset(lowerName)


    private const val MAX_PROJECT_DEPTH = 24
    private const val MAX_PROJECT_FILES = 3000
    private const val MAX_PROJECT_FILE_BYTES = 2L * 1024 * 1024
    private const val MAX_PROJECT_TOTAL_BYTES = 40L * 1024 * 1024

    private val PROJECT_IGNORED = setOf(
      "node_modules",
      ".git",
      ".svn",
      ".hg",
      "target",
      "build",
      "dist",
      "out",
      ".idea",
      ".vscode",
      ".next",
      ".turbo",
      ".cache",
      "__pycache__",
      ".gradle",
      ".mvn",
      "vendor",
      "coverage",
      ".DS_Store",
      "Thumbs.db",
      "__MACOSX"
    )

    private val PROJECT_TEXT_EXTS = setOf(
      "java", "cpp", "cc", "cxx", "c", "h", "hpp", "hh", "hxx",
      "js", "mjs", "cjs", "jsx", "ts", "tsx", "json", "md", "markdown", "mdx",
      "html", "htm", "css", "scss", "less", "xml", "xsl", "svg", "py", "rs",
      "go", "txt", "toml", "yaml", "yml", "ini", "cfg", "properties", "gradle",
      "kt", "kts", "sql", "sh", "bash", "zsh", "env", "gitignore", "dockerignore",
      "editorconfig", "pom"
    )

    fun shouldIgnoreProject(name: String): Boolean {
      if (name.isEmpty()) return true
      if (PROJECT_IGNORED.contains(name)) return true
      if (name == ".env" || name == ".gitignore" || name == ".editorconfig") return false
      return name.startsWith(".")
    }

    fun isProjectText(name: String): Boolean {
      if (name == "Makefile" || name == "Dockerfile" || name == "pom.xml") return true
      val dot = name.lastIndexOf('.')
      if (dot <= 0) return name.startsWith(".")
      val ext = name.substring(dot + 1).lowercase()
      return PROJECT_TEXT_EXTS.contains(ext)
    }

    fun sanitizePath(relPath: String): List<String> {
      val parts = mutableListOf<String>()
      for (seg in relPath.replace('\\', '/').split('/')) {
        if (seg.isEmpty() || seg == ".") continue
        if (seg == "..") throw IllegalArgumentException("路径无效")
        parts.add(seg)
      }
      return parts
    }
  }
}
