import requests
import os
import re

def download_manuscript():
    # Demande l'URL à l'utilisateur
    print("--- Téléchargeur de Manuscrits (Fondation Roi Abdul-Aziz) ---")
    full_url = input("Collez l'URL de la PREMIÈRE image (ex: .../1204.jpg) : ").strip()
    
    if not full_url:
        print("Erreur : URL vide.")
        return

    # Demande le nombre de pages
    try:
        count_input = input("Nombre de pages à télécharger : ").strip()
        total_pages = int(count_input)
    except ValueError:
        print("Erreur : Le nombre de pages doit être un entier.")
        return

    # Extraction de la base de l'URL, du nom du dossier, et du numéro de départ
    parts = full_url.split('/')
    base_url = "/".join(parts[:-1]) + "/"
    filename = parts[-1]
    
    # Extraire le numéro et l'extension (ex: 1204.jpg -> 1204, .jpg)
    match = re.search(r'(\d+)(\.\w+)$', filename)
    if not match:
        print("Erreur : Impossible de trouver un numéro à la fin de l'URL.")
        return
    
    start_num_str = match.group(1)
    extension = match.group(2)
    start_num = int(start_num_str)
    padding = len(start_num_str) # Garder le même nombre de zéros si nécessaire
    
    # On récupère l'avant-dernière partie pour nommer le dossier (ex: 252T1-608)
    folder_name = parts[-2] if len(parts) > 2 else "manuscrit_dl"
    
    if not os.path.exists(folder_name):
        os.makedirs(folder_name)

    print(f"\nEnregistrement dans le dossier : {folder_name}")
    print(f"Téléchargement de {total_pages} images à partir de {start_num}...")
    print("Appuyez sur Ctrl+C pour arrêter.\n")

    for i in range(total_pages):
        current_num = start_num + i
        # Formater avec le padding original (ex: 001 si c'était 001)
        current_num_str = str(current_num).zfill(padding)
        file_url = f"{base_url}{current_num_str}{extension}"
        
        try:
            response = requests.get(file_url, timeout=10, stream=True)
            
            if response.status_code != 200:
                print(f"\n[ERREUR] Page {current_num_str} non trouvée (Code {response.status_code}).")
                # On ne break pas forcément, le serveur peut avoir des trous
                continue
            
            # Téléchargement effectif
            file_path = os.path.join(folder_name, f"{current_num_str}{extension}")
            with open(file_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            print(f"\rProgression : {i+1}/{total_pages} ({current_num_str}{extension})", end="", flush=True)
            
        except KeyboardInterrupt:
            print("\nArrêt demandé par l'utilisateur.")
            break
        except Exception as e:
            print(f"\nErreur sur {current_num_str} : {e}")
            continue

    print(f"\nTerminé ! Dossier : {os.path.abspath(folder_name)}")

if __name__ == "__main__":
    download_manuscript()