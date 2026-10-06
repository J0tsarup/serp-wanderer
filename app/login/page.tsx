import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="max-w-sm mx-auto mt-16">
      <h1 className="text-xl font-semibold text-ink mb-6 text-center">Sign in</h1>
      <LoginForm />
    </div>
  );
}
