# kview Linux Desktop Bundle

Run `./install.sh` to install kview for the current user. The installer writes only
to `~/.local/bin` and the user XDG data directory; it does not require root.

The desktop build requires GTK 3 and WebKitGTK 4.1 runtime libraries. On
Debian/Ubuntu, install `libgtk-3-0` and `libwebkit2gtk-4.1-0` if they are not
already present.

You can also run the bundled `kview` binary directly without installing it.
