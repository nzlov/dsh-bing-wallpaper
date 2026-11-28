# Install SHARP manually

[简体中文](sharp-install.zh-CN.md) · English

Install SHARP on the machine that runs DSH Web. Use the active DSH profile's `model-runtime/sharp` directory. The default `web` profile on Linux and macOS uses `${DSH_HOME:-$HOME/.dsh}/profiles/web`. If your server uses a different profile or DSH home, use its actual absolute path.

The plugin looks for `venv/bin/python` (`venv/Scripts/python.exe` on Windows) and `sharp_2572gikvuh.pt` in that directory. Both files must be accessible to the account running DSH. If your copy of SHARP is already installed elsewhere, follow [Use an existing installation](#use-an-existing-installation).

## Install on Linux or macOS

1. With Git, `curl`, and Python 3.13 available on the server, create a virtual environment. These commands use the default `web` profile and pin the Apple source used for verification. [Apple's setup instructions](https://github.com/apple-aiml-research/ml-sharp#getting-started)

   ```sh
   sharp_dir="${DSH_HOME:-$HOME/.dsh}/profiles/web/model-runtime/sharp"
   mkdir -p "$sharp_dir"
   python3.13 -m venv "$sharp_dir/venv"
   sharp_python="$sharp_dir/venv/bin/python"

   git clone https://github.com/apple-aiml-research/ml-sharp.git "$sharp_dir/ml-sharp"
   git -C "$sharp_dir/ml-sharp" checkout --detach aed6527499ef91cba3b54c18d49a870f25947190
   ```

2. Install the dependencies from the cloned directory and check that the inference entry point can be imported. Keep the clone in place because Apple's requirements install it in editable mode.

   ```sh
   cd "$sharp_dir/ml-sharp"
   "$sharp_python" -m pip install -r requirements.txt
   "$sharp_python" -I -c 'import torch; from sharp.cli.predict import predict_image; print(torch.__version__)'
   ```

3. Download the 2.81 GB checkpoint from Apple. If you already have this file, put it in the same destination with the indicated filename. Apple licenses these weights for non-commercial scientific research and academic development. [Model license](https://github.com/apple-aiml-research/ml-sharp/blob/main/LICENSE_MODEL)

   ```sh
   curl --fail --location \
     --output "$sharp_dir/sharp_2572gikvuh.pt.part" \
     https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt && \
     mv "$sharp_dir/sharp_2572gikvuh.pt.part" "$sharp_dir/sharp_2572gikvuh.pt"
   ```

4. Restart DSH using the launcher or service manager you normally use. Refresh the browser, then choose **Settings → Bing daily wallpaper → Parallax mode → 3D scene (SHARP)**.

## Use an existing installation

If your SHARP environment and checkpoint are already at the default paths, restart DSH and select the mode. To keep them elsewhere, set both variables to absolute paths in the environment that starts DSH. The plugin gives these paths precedence over the profile directory. Restart DSH after changing them.

```sh
export BDT_SHARP_PYTHON=/absolute/path/to/sharp-venv/bin/python
export BDT_SHARP_CHECKPOINT=/absolute/path/to/sharp_2572gikvuh.pt
```

On Windows, use the virtual environment's `Scripts\python.exe` and set the variables in the shell or service that launches DSH.
