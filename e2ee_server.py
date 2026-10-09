from flask import Flask, render_template
from flask_socketio import SocketIO, emit

app = Flask(__name__)

app.config["SECRET_KEY"] = "e2ee-chat-secret"

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading"
)


# Bağlı kullanıcıların public key bilgileri
users = {}


@app.route("/")
def index():
    return render_template("e2ee_index.html")


# Kullanıcı bağlandığında
@socketio.on("connect")
def handle_connect():

    print()
    print("[YENİ BAĞLANTI]")
    print()


# Kullanıcı sohbete katıldığında
@socketio.on("join")
def handle_join(data):

    name = str(data.get("name", "Anonim")).strip()

    if not name:
        name = "Anonim"

    name = name[:24]

    public_key = data.get("public_key")

    if not public_key:
        print("[HATA] Public key gönderilmedi.")
        return

    users[request_sid()] = {
        "name": name,
        "public_key": public_key
    }

    print()
    print("[KULLANICI KATILDI]")
    print(f"İsim: {name}")
    print(f"Public key alındı: EVET")
    print()

    # Sisteme katılma mesajı
    emit(
        "system_message",
        {
            "text": f"{name} sohbete katıldı."
        },
        broadcast=True
    )


    send_public_keys()



def send_public_keys():

    public_keys = {}

    for sid, user in users.items():

        public_keys[sid] = {
            "name": user["name"],
            "public_key": user["public_key"]
        }

    socketio.emit(
        "public_keys",
        public_keys
    )


# Kullanıcı ayrıldığında
@socketio.on("disconnect")
def handle_disconnect():

    sid = request_sid()

    if sid in users:

        name = users[sid]["name"]

        print()
        print("[KULLANICI AYRILDI]")
        print(f"İsim: {name}")
        print()

        del users[sid]

        socketio.emit(
            "system_message",
            {
                "text": f"{name} sohbetten ayrıldı."
            }
        )

        send_public_keys()


# ŞİFRELİ mesaj
@socketio.on("encrypted_message")
def handle_encrypted_message(data):

    encrypted_text = data.get("encrypted_text")
    sender_name = data.get("name", "Anonim")

    # Mesaj anahtarlarının sarılmış halleri
    wrapped_keys = data.get("wrapped_keys")

    # AES IV
    iv = data.get("iv")

    if not encrypted_text:
        return

    if not wrapped_keys:
        return

    if not iv:
        return

    sender_name = str(sender_name)[:24]

    print()
    print("[ŞİFRELİ MESAJ GELDİ]")
    print(f"Gönderen: {sender_name}")
    print(f"Şifreli veri uzunluğu: {len(str(encrypted_text))}")
    print(f"Sarılmış anahtar sayısı: {len(wrapped_keys)}")
    print()

    # ÖNEMLİ:
    #
    # Server burada mesajı çözmez.
    #
    # encrypted_text olduğu gibi aktarılır.
    #
    # wrapped_keys içindeki AES anahtarlarını da çözmez.
    #
    # Sadece diğer istemcilere aktarır.

    emit(
        "encrypted_message",
        {
            "name": sender_name,
            "encrypted_text": encrypted_text,
            "wrapped_keys": wrapped_keys,
            "iv": iv
        },
        broadcast=True
    )


# Socket.IO içinde mevcut bağlantının SID'sini almak için
def request_sid():
    from flask import request
    return request.sid


if __name__ == "__main__":

    print()
    print("===================================")
    print("       E2EE ANONYMOUS CHAT")
    print("===================================")
    print()

    print("Sunucu çalışıyor.")
    print()

    print("Yerel adres:")
    print("http://127.0.0.1:5000")
    print()

    print("E2EE mesaj sistemi: AKTİF")
    print()

    print("Durdurmak için CTRL + C")
    print()

    socketio.run(
        app,
        host="0.0.0.0",
        port=5000,
        debug=False
    )