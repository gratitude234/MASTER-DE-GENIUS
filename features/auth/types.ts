export type AuthActionState = {
  error?: string;
  fieldErrors?: Partial<Record<"fullName" | "email" | "password" | "confirmPassword", string>>;
};

export const initialAuthState: AuthActionState = {};
