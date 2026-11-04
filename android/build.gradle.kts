allprojects {
    repositories {
        // Flutter engine artifacts (io.flutter:flutter_embedding_*, *_release
        // .so packages) are ONLY hosted here — put it first so resolution
        // never falls through to slower / rate-limited repositories.
        maven("https://storage.googleapis.com/download.flutter.io")
        // Maven Central rate-limit (HTTP 429) workaround:
        // mirrors first, canonical repos kept as fallback.
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/central")
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Legacy Flutter plugins published before AGP 8 (e.g. isar_flutter_libs
// 3.1.0+1) do not declare a namespace, which AGP 8+/9 hard-fails on.
// Inject one, derived from the plugin's AndroidManifest package attribute.
// Also: several plugins pin old compileSdk values (isar 30, file_picker 34,
// pdfx 35) while their own dependencies (e.g. flutter_plugin_android_lifecycle
// 2.0.35) are compiled against SDK 36 and require dependents to match — force
// every library subproject up to compileSdk 36. Registered from the root
// project so it runs before AGP's own afterEvaluate variant creation.
subprojects {
    project.plugins.withId("com.android.library") {
        val libraryExt =
            project.extensions.getByType(com.android.build.gradle.LibraryExtension::class.java)
        if (libraryExt.namespace.isNullOrEmpty()) {
            val manifestFile = project.file("src/main/AndroidManifest.xml")
            val manifestPackage =
                if (manifestFile.exists()) {
                    try {
                        javax.xml.parsers.DocumentBuilderFactory.newInstance()
                            .newDocumentBuilder()
                            .parse(manifestFile)
                            .documentElement
                            .getAttribute("package")
                    } catch (e: Exception) {
                        ""
                    }
                } else {
                    ""
                }
            libraryExt.namespace =
                when {
                    manifestPackage.isNotBlank() -> manifestPackage
                    !project.group.toString().isNullOrEmpty() -> project.group.toString()
                    else -> "com.nanote.plugins.${project.name}"
                }
            project.logger.lifecycle(
                "Injected namespace '${libraryExt.namespace}' into legacy plugin :${project.name}"
            )
        }
    }
    // :app is force-evaluated early by the evaluationDependsOn block above,
    // and it never matches "com.android.library" anyway — only register the
    // hook for projects that are not evaluated yet.
    if (!project.state.executed) {
        project.afterEvaluate {
            project.plugins.withId("com.android.library") {
                val libraryExt =
                    project.extensions.getByType(com.android.build.gradle.LibraryExtension::class.java)
                if ((libraryExt.compileSdk ?: 0) < 36) {
                    val old = libraryExt.compileSdk
                    libraryExt.compileSdk = 36
                    project.logger.lifecycle(
                        "Bumped :${project.name} compileSdk $old -> 36"
                    )
                }
            }
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
