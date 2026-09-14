export const en = {
  customer: {
    header: "Customer area",
    eyebrow: "QR foundation",
    title: "Customer layout",
    description: "The customer shell is ready for later phases."
  },
  staff: {
    header: "Staff area",
    eyebrow: "Operations foundation",
    title: "Staff layout",
    description: "The staff shell is ready for later phases."
  },
  admin: {
    header: "Admin area",
    eyebrow: "Admin foundation",
    title: "Admin layout",
    description: "The admin shell is ready for later phases."
  },
  theme: {
    dark: "Dark mode",
    light: "Light mode"
  },
  auth: {
    brandVisualLabel: "Cafe workspace",
    visualEyebrow: "Connected operations",
    visualTitle: "Calm, considered cafe operations.",
    visualDescription: "Manage people, orders, and daily operations from the workspace assigned to you.",
    secureAccess: "Access permissions are always verified by the server",
    customerArea: "Customer area",
    portalEyebrow: "WebOrder team portal",
    loginTitle: "Welcome back",
    registerTitle: "Request an account",
    loginDescription: "Choose your workspace and continue with an authorized Google account.",
    registerDescription: "Request a new staff account for an Admin to review and approve.",
    adminRegisterDescriptionShort: "Admin accounts can only be created or authorized through the secured administration process.",
    modeLabel: "Choose sign in or register",
    loginTab: "Sign in",
    registerTab: "Register",
    areaLabel: "Which workspace do you need?",
    adminArea: "Admin",
    adminAreaDescription: "System, people, and venue configuration",
    staffArea: "Staff",
    staffAreaDescription: "Tables, kitchen, cashier, and service operations",
    adminBenefitOne: "Only server-authorized Admin accounts can enter",
    adminBenefitTwo: "Admin permission is never granted by this screen",
    staffBenefitOne: "Approved staff enter their assigned operations workspace",
    staffBenefitTwo: "New accounts are sent to Admin in pending status",
    adminRegistrationTitle: "Public Admin registration is unavailable",
    adminRegistrationDescription: "For security, an Admin must be created during first-time setup or granted access by an authorized Admin.",
    openFirstSetup: "Open first-time setup",
    setupRequired: "First-time setup must be completed before staff can sign in.",
    continueGoogle: "Continue with Google",
    registerGoogle: "Register with Google",
    redirecting: "Redirecting to Google...",
    notRegisteredError: "This account is not registered. Choose Register > Staff to request an account.",
    oauthError: "Google sign-in could not be started. Please try again.",
    setupStatusError: "System status could not be checked. Please try again later.",
    signOutRetry: "Sign out and try another account",
    backendAuthority: "Roles and permissions are verified by the server"
  },
  setup: {
    loading: "Loading",
    unavailable: "Setup status is unavailable",
    eyebrow: "First-time setup",
    signInTitle: "Sign in with Google to set up",
    signInDescription: "The backend verifies the Supabase JWT before creating the first admin.",
    signInGoogle: "Sign in with Google",
    title: "Create the first branch and admin",
    description: "The setup token is sent once to the backend and is not stored in the browser.",
    token: "Setup token",
    branchCode: "Branch code",
    branchName: "Branch name",
    adminName: "Admin display name",
    submit: "Complete setup",
    submitting: "Submitting",
    errors: {
      signInRequired: "Please sign in with Google first",
      generic: "Setup could not be completed"
    }
  },
  pending: {
    signInTitle: "Staff sign-in",
    signInDescription: "A new account is registered and waits for approval.",
    title: "Account pending approval",
    description: "Your registration has been received. Admin approval belongs to the staff management phase.",
    registering: "Registering",
    currentAccount: "Current Google account",
    switchAccount: "Use another Google account",
    switchingAccount: "Signing out...",
    switchAccountError: "The account could not be changed. Please try again."
  }
};
