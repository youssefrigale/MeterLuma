# Native runtime notices

These upstream texts supplement crate/package notices for native code linked into or shipped beside MeterLuma. They retain their own terms, separately from MeterLuma's personal-use license. The notices generator includes their full text in THIRD_PARTY_NOTICES.txt, which is bundled with the application and available in its license screen.

`webview2-sdk` contains LICENSE.txt and NOTICE.txt from Microsoft's exact NuGet SDK 1.0.3800.47 archive. Its x64 WebView2Loader.dll was checked byte-for-byte by SHA-256 against the loader supplied by webview2-com-sys 0.39.1. MSVC uses the SDK static loader; the local GNU Windows beta ships its dynamic loader.

`llvm-runtime` contains the LLVM license supplied in the llvm-mingw 20261006 UCRT x86_64 toolchain archive. The local GNU Windows beta ships that toolchain's libunwind.dll. Standard MSVC builds do not need this DLL. The inventory intentionally includes components that apply only to some builds.

Exact archive URLs and versions are recorded in runtime-components.json. Update these notices and verify native runtime versions when upgrading the corresponding dependencies or toolchain. These files are collected notices, not a legal certification of the release.
