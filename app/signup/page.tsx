import SignupForm from "@/components/SignupForm";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <div className="max-w-sm mx-auto mt-16">
      <h1 className="text-xl font-semibold text-ink mb-6 text-center">Create your account</h1>
      <SignupForm />
    </div>
  );
}
