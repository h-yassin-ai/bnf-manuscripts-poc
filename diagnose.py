import os
import json
import time

models_dir = "/home/vps/models_vps"
print(f"=== Scanning models directory: {models_dir} ===")

if not os.path.exists(models_dir):
    print(f"Directory not found: {models_dir}")
    # Try parent directory as fallback
    parent = os.path.dirname(models_dir)
    print(f"Contents of {parent}: {os.listdir(parent) if os.path.exists(parent) else 'Not found'}")
    exit(1)

# List all files and folders recursively
for root, dirs, files in os.walk(models_dir):
    # Only inspect directories that contain adapter_config.json
    if "adapter_config.json" in files:
        print(f"\nFound adapter checkpoint: {root}")
        
        # Check modification time of adapter_model.safetensors or adapter_model.bin
        weights_file = None
        for f in ["adapter_model.safetensors", "adapter_model.bin"]:
            if f in files:
                weights_file = os.path.join(root, f)
                break
                
        if weights_file:
            mtime = os.path.getmtime(weights_file)
            size = os.path.getsize(weights_file) / (1024 * 1024) # MB
            print(f"  Weights file: {os.path.basename(weights_file)}")
            print(f"  Size: {size:.2f} MB")
            print(f"  Last Modified: {time.ctime(mtime)}")
        else:
            print("  Warning: No weights file (adapter_model.safetensors/bin) found!")
            
        # Print config details
        config_path = os.path.join(root, "adapter_config.json")
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            print(f"  Base Model: {cfg.get('base_model_name_or_path')}")
            print(f"  PEFT Version: {cfg.get('peft_version')}")
        except Exception as e:
            print(f"  Error reading config: {e}")

print("\n=== Scan Complete ===")
