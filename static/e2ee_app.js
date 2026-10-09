const socket = io();


const messages = document.getElementById("messages");
const form = document.getElementById("messageForm");
const input = document.getElementById("messageInput");
const status = document.getElementById("status");

const modal = document.getElementById("nameModal");
const nameInput = document.getElementById("nameInput");
const joinButton = document.getElementById("joinButton");


let myName = "";
let myKeyPair = null;


/*
    Bağlı kullanıcıların public key'leri

    Yapı:

    {
        socket_id: {
            name: "...",
            public_key: {...}
        }
    }
*/
let publicKeys = {};



/* =========================================================
   SOCKET.IO BAĞLANTISI
========================================================= */

socket.on("connect", () => {

    status.textContent = "Bağlı";

    console.log("Socket.IO bağlantısı kuruldu.");
    console.log("Socket ID:", socket.id);

});


socket.on("disconnect", () => {

    status.textContent = "Bağlantı kesildi";

});



/* =========================================================
   KULLANICI ADI
========================================================= */

joinButton.addEventListener(
    "click",
    joinChat
);


nameInput.addEventListener(
    "keydown",
    (event) => {

        if (event.key === "Enter") {

            joinChat();

        }

    }
);



/* =========================================================
   BASE64 YARDIMCILARI
========================================================= */

function arrayBufferToBase64(buffer) {

    const bytes = new Uint8Array(buffer);

    let binary = "";

    for (let i = 0; i < bytes.byteLength; i++) {

        binary += String.fromCharCode(bytes[i]);

    }

    return btoa(binary);
}


function base64ToArrayBuffer(base64) {

    const binary = atob(base64);

    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {

        bytes[i] = binary.charCodeAt(i);

    }

    return bytes.buffer;
}



/* =========================================================
   RSA PUBLIC KEY IMPORT
========================================================= */

async function importPublicKey(jwk) {

    return await crypto.subtle.importKey(

        "jwk",

        jwk,

        {
            name: "RSA-OAEP",
            hash: "SHA-256"
        },

        false,

        [
            "encrypt"
        ]

    );

}



/* =========================================================
   SOHBETE KATIL
========================================================= */

async function joinChat() {

    myName = nameInput.value.trim();


    if (!myName) {

        myName = "Anonim";

    }


    myName = myName.substring(0, 24);


    /*
        Web Crypto kontrolü
    */

    if (!window.isSecureContext) {

        alert(
            "E2EE için HTTPS bağlantısı gerekiyor.\n\n" +
            "Cloudflare HTTPS adresini kullan."
        );

        return;

    }


    if (!window.crypto || !window.crypto.subtle) {

        alert(
            "Tarayıcınız Web Crypto API'yi desteklemiyor."
        );

        return;

    }


    /*
        RSA-OAEP anahtar çifti oluştur
    */

    try {

        myKeyPair = await crypto.subtle.generateKey(

            {
                name: "RSA-OAEP",

                modulusLength: 2048,

                publicExponent: new Uint8Array(
                    [1, 0, 1]
                ),

                hash: "SHA-256"
            },

            true,

            [
                "encrypt",
                "decrypt"
            ]

        );


        console.log(
            "E2EE RSA anahtar çifti oluşturuldu."
        );


        /*
            Public key'i JWK formatına çeviriyoruz.

            Private key hiçbir yere gönderilmiyor.
        */

        const publicKeyJWK =
            await crypto.subtle.exportKey(
                "jwk",
                myKeyPair.publicKey
            );


        console.log(
            "Public key hazır."
        );


        /*
            Sunucuya yalnızca:

            isim
            public key

            gönderiliyor.
        */

        socket.emit(
            "join",
            {
                name: myName,
                public_key: publicKeyJWK
            }
        );


        modal.style.display = "none";

        input.focus();


    } catch (error) {

        console.error(
            "Anahtar oluşturulamadı:",
            error
        );

        alert(
            "E2EE anahtarı oluşturulamadı.\n\n" +
            error
        );

        return;

    }

}



/* =========================================================
   PUBLIC KEY LİSTESİ
========================================================= */

socket.on(
    "public_keys",
    (data) => {

        publicKeys = data;

        console.log(
            "Public key listesi güncellendi:",
            publicKeys
        );

    }
);



/* =========================================================
   MESAJ ŞİFRELEME
========================================================= */

async function encryptMessage(text) {

    /*
        Her mesaj için yeni AES-256 anahtarı
    */

    const aesKey =
        await crypto.subtle.generateKey(

            {
                name: "AES-GCM",
                length: 256
            },

            true,

            [
                "encrypt",
                "decrypt"
            ]

        );


    /*
        Her mesaj için rastgele IV
    */

    const iv =
        crypto.getRandomValues(
            new Uint8Array(12)
        );


    /*
        Metni UTF-8 byte'larına çevir
    */

    const encodedText =
        new TextEncoder().encode(text);


    /*
        AES-GCM ile gerçek şifreleme
    */

    const ciphertext =
        await crypto.subtle.encrypt(

            {
                name: "AES-GCM",
                iv: iv
            },

            aesKey,

            encodedText

        );


    /*
        AES anahtarını dışarı çıkar.
    */

    const rawAESKey =
        await crypto.subtle.exportKey(
            "raw",
            aesKey
        );


    /*
        AES anahtarını her kullanıcının
        RSA public key'i ile ayrı ayrı şifrele.
    */

    const wrappedKeys = {};


    for (
        const [sid, user] of Object.entries(publicKeys)
    ) {

        try {

            const recipientPublicKey =
                await importPublicKey(
                    user.public_key
                );


            const wrappedAESKey =
                await crypto.subtle.encrypt(

                    {
                        name: "RSA-OAEP"
                    },

                    recipientPublicKey,

                    rawAESKey

                );


            wrappedKeys[sid] =
                arrayBufferToBase64(
                    wrappedAESKey
                );


        } catch (error) {

            console.error(
                "Public key ile AES anahtarı sarılamadı:",
                sid,
                error
            );

        }

    }


    return {

        encrypted_text:
            arrayBufferToBase64(
                ciphertext
            ),

        iv:
            arrayBufferToBase64(iv.buffer),

        wrapped_keys:
            wrappedKeys

    };

}



/* =========================================================
   GELEN MESAJI ÇÖZ
========================================================= */

async function decryptMessage(data) {

    try {

        /*
            Bu mesajın benim için sarılmış
            AES anahtarını bul.
        */

        const wrappedKey =
            data.wrapped_keys[socket.id];


        /*
            Eğer benim için anahtar yoksa
            mesajı çözemem.
        */

        if (!wrappedKey) {

            console.log(
                "Bu mesaj için bana ait AES anahtarı yok."
            );

            return null;

        }


        /*
            RSA private key ile AES anahtarını çöz.
        */

        const rawAESKey =
            await crypto.subtle.decrypt(

                {
                    name: "RSA-OAEP"
                },

                myKeyPair.privateKey,

                base64ToArrayBuffer(
                    wrappedKey
                )

            );


        /*
            Çözülen raw AES key'i
            tekrar CryptoKey'e dönüştür.
        */

        const aesKey =
            await crypto.subtle.importKey(

                "raw",

                rawAESKey,

                {
                    name: "AES-GCM"
                },

                false,

                [
                    "decrypt"
                ]

            );


        /*
            IV'yi al
        */

        const iv =
            new Uint8Array(
                base64ToArrayBuffer(
                    data.iv
                )
            );


        /*
            Ciphertext'i al
        */

        const ciphertext =
            base64ToArrayBuffer(
                data.encrypted_text
            );


        /*
            AES-GCM ile çöz
        */

        const plaintext =
            await crypto.subtle.decrypt(

                {
                    name: "AES-GCM",
                    iv: iv
                },

                aesKey,

                ciphertext

            );


        /*
            UTF-8 metne dönüştür
        */

        return new TextDecoder().decode(
            plaintext
        );


    } catch (error) {

        console.error(
            "Mesaj çözülemedi:",
            error
        );

        return null;

    }

}



/* =========================================================
   GELEN ŞİFRELİ MESAJ
========================================================= */

socket.on(
    "encrypted_message",
    async (data) => {

        console.log(
            "[ŞİFRELİ MESAJ GELDİ]"
        );

        console.log(
            "Gönderen:",
            data.name
        );

        console.log(
            "Şifreli veri:",
            data.encrypted_text
        );


        /*
            Henüz kendi anahtarımız yoksa
            çözmeye çalışma.
        */

        if (!myKeyPair) {

            return;

        }


        const decryptedText =
            await decryptMessage(data);


        if (decryptedText === null) {

            console.log(
                "Mesaj bu istemci tarafından çözülemedi."
            );

            return;

        }


        /*
            Çözülmüş mesajı ekrana yaz.
        */

        addMessage(
            data.name,
            decryptedText
        );

    }
);



/* =========================================================
   SİSTEM MESAJI
========================================================= */

socket.on(
    "system_message",
    (data) => {

        addSystemMessage(
            data.text
        );

    }
);



/* =========================================================
   MESAJ GÖNDERME
========================================================= */

form.addEventListener(
    "submit",
    async (event) => {

        event.preventDefault();


        const text =
            input.value.trim();


        if (!text) {

            return;

        }


        if (!socket.connected) {

            alert(
                "Sunucuya bağlı değilsin."
            );

            return;

        }


        if (!myKeyPair) {

            alert(
                "Önce sohbete katıl."
            );

            return;

        }


        /*
            Güncel public key listesi
            henüz gelmediyse gönderme.
        */

        if (
            Object.keys(publicKeys).length === 0
        ) {

            alert(
                "Henüz kullanıcı anahtarları alınmadı."
            );

            return;

        }


        try {

            const encrypted =
                await encryptMessage(text);


            console.log(
                "Mesaj şifrelendi."
            );


            console.log(
                "Şifreli veri:",
                encrypted.encrypted_text
            );


            socket.emit(
                "encrypted_message",
                {
                    name: myName,

                    encrypted_text:
                        encrypted.encrypted_text,

                    iv:
                        encrypted.iv,

                    wrapped_keys:
                        encrypted.wrapped_keys
                }
            );


            input.value = "";

            input.focus();


        } catch (error) {

            console.error(
                "Mesaj şifrelenemedi:",
                error
            );

            alert(
                "Mesaj şifrelenemedi."
            );

        }

    }
);



/* =========================================================
   MESAJ ARAYÜZÜ
========================================================= */

function addMessage(
    name,
    text
) {

    const message =
        document.createElement("div");


    message.className =
        "message";


    const nameElement =
        document.createElement("strong");


    nameElement.textContent =
        name;


    const textElement =
        document.createElement("span");


    textElement.textContent =
        text;


    message.appendChild(
        nameElement
    );


    message.appendChild(
        textElement
    );


    messages.appendChild(
        message
    );


    messages.scrollTop =
        messages.scrollHeight;

}



/* =========================================================
   SİSTEM MESAJI ARAYÜZÜ
========================================================= */

function addSystemMessage(text) {

    const message =
        document.createElement("div");


    message.className =
        "system";


    message.textContent =
        text;


    messages.appendChild(
        message
    );


    messages.scrollTop =
        messages.scrollHeight;

}