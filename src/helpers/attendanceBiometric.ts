export type AttendanceBiometricResult = {
  verified: boolean;
  method: "webauthn-platform";
  verifiedAtClient: string;
  credentialId?: string;
};

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function isPlatformBiometricAvailable() {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  if (!("PublicKeyCredential" in window)) return false;

  const credentialApi = window.PublicKeyCredential as typeof PublicKeyCredential & {
    isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  };

  if (typeof credentialApi.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
    return true;
  }

  return credentialApi.isUserVerifyingPlatformAuthenticatorAvailable();
}

export async function requestAttendanceBiometric(args: {
  employeeId: string;
  displayName: string;
  action: "check_in" | "check_out";
}): Promise<AttendanceBiometricResult> {
  if (typeof window === "undefined" || !window.isSecureContext) {
    throw new Error("البصمة تحتاج تشغيل الموقع على HTTPS أو localhost.");
  }

  if (!("PublicKeyCredential" in window) || !navigator.credentials?.create) {
    throw new Error("البصمة غير مدعومة في هذا المتصفح أو الجهاز.");
  }

  const available = await isPlatformBiometricAvailable();
  if (!available) {
    throw new Error("لا يوجد قارئ بصمة أو تحقق آمن مفعل على هذا الجهاز.");
  }

  const userName = args.displayName || args.employeeId || "employee";
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: {
        name: "Queens Salon",
      },
      user: {
        id: randomBytes(16),
        name: `${args.employeeId}@attendance.local`,
        displayName: userName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "discouraged",
        userVerification: "required",
      },
      attestation: "none",
      timeout: 60000,
    },
  });

  if (!credential) {
    throw new Error("لم يتم تأكيد البصمة.");
  }

  return {
    verified: true,
    method: "webauthn-platform",
    verifiedAtClient: new Date().toISOString(),
    credentialId: "rawId" in credential ? toBase64Url((credential as PublicKeyCredential).rawId) : credential.id,
  };
}
