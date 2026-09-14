export const vi = {
  customer: {
    header: "Khu vực khách",
    eyebrow: "Nền tảng QR",
    title: "Customer layout",
    description: "Khung giao diện khách hàng đã sẵn sàng cho các phase sau."
  },
  staff: {
    header: "Khu vực nhân viên",
    eyebrow: "Nền tảng vận hành",
    title: "Staff layout",
    description: "Khung giao diện nhân viên đã sẵn sàng cho các phase sau."
  },
  admin: {
    header: "Khu vực quản trị",
    eyebrow: "Nền tảng quản trị",
    title: "Admin layout",
    description: "Khung giao diện quản trị đã sẵn sàng cho các phase sau."
  },
  theme: {
    dark: "Chế độ tối",
    light: "Chế độ sáng"
  },
  auth: {
    brandVisualLabel: "Không gian quán",
    visualEyebrow: "Vận hành tập trung",
    visualTitle: "Một điểm vào cho toàn bộ đội ngũ quán.",
    visualDescription: "Quản lý nhân sự, đơn hàng và vận hành hằng ngày từ đúng khu vực làm việc của bạn.",
    secureAccess: "Quyền truy cập luôn được xác minh bởi máy chủ",
    customerArea: "Khu vực khách hàng",
    portalEyebrow: "Cổng nội bộ WebOrder",
    loginTitle: "Chào mừng bạn trở lại",
    registerTitle: "Tạo yêu cầu tài khoản",
    loginDescription: "Chọn khu vực làm việc và tiếp tục bằng tài khoản Google đã được cấp quyền.",
    registerDescription: "Đăng ký tài khoản nhân viên mới để Admin xem xét và phê duyệt.",
    modeLabel: "Chọn đăng nhập hoặc đăng ký",
    loginTab: "Đăng nhập",
    registerTab: "Đăng ký",
    areaLabel: "Bạn muốn vào khu vực nào?",
    adminArea: "Admin",
    adminAreaDescription: "Quản trị hệ thống, nhân sự và cấu hình quán",
    staffArea: "Nhân viên",
    staffAreaDescription: "Vận hành bàn, bếp, thu ngân và phục vụ",
    adminBenefitOne: "Chỉ tài khoản Admin đã được hệ thống xác nhận mới có thể truy cập",
    adminBenefitTwo: "Quyền quản trị không được cấp từ lựa chọn trên giao diện",
    staffBenefitOne: "Nhân viên đã duyệt sẽ vào đúng khu vực vận hành được phân công",
    staffBenefitTwo: "Tài khoản mới sẽ được gửi tới Admin và ở trạng thái chờ duyệt",
    adminRegistrationTitle: "Không hỗ trợ tự đăng ký Admin",
    adminRegistrationDescription: "Để bảo vệ hệ thống, Admin phải được tạo ở bước thiết lập đầu tiên hoặc được một Admin có thẩm quyền cấp quyền.",
    openFirstSetup: "Mở thiết lập lần đầu",
    setupRequired: "Hệ thống cần hoàn tất thiết lập lần đầu trước khi nhân viên có thể đăng nhập.",
    continueGoogle: "Tiếp tục với Google",
    registerGoogle: "Đăng ký bằng Google",
    redirecting: "Đang chuyển tới Google...",
    notRegisteredError: "Tài khoản này chưa được đăng ký. Hãy chọn Đăng ký > Nhân viên để gửi yêu cầu tài khoản.",
    oauthError: "Không thể bắt đầu đăng nhập Google. Vui lòng thử lại.",
    setupStatusError: "Không thể kiểm tra trạng thái hệ thống. Vui lòng thử lại sau.",
    signOutRetry: "Đăng xuất và thử tài khoản khác",
    backendAuthority: "Vai trò và quyền hạn do hệ thống xác nhận"
  },
  setup: {
    loading: "Đang tải",
    unavailable: "Chưa thể đọc trạng thái setup",
    eyebrow: "Thiết lập lần đầu",
    signInTitle: "Đăng nhập Google để thiết lập",
    signInDescription: "Backend sẽ xác thực Supabase JWT trước khi cho phép tạo admin đầu tiên.",
    signInGoogle: "Đăng nhập Google",
    title: "Tạo chi nhánh và admin đầu tiên",
    description: "Setup token chỉ được gửi một lần tới backend và không được lưu trong trình duyệt.",
    token: "Setup token",
    branchCode: "Mã chi nhánh",
    branchName: "Tên chi nhánh",
    adminName: "Tên hiển thị admin",
    submit: "Hoàn tất setup",
    submitting: "Đang xử lý",
    errors: {
      signInRequired: "Vui lòng đăng nhập Google trước",
      generic: "Không thể hoàn tất setup"
    }
  },
  pending: {
    signInTitle: "Đăng nhập nhân viên",
    signInDescription: "Tài khoản mới sẽ được gửi đăng ký và chờ duyệt.",
    title: "Tài khoản đang chờ duyệt",
    description: "Bạn đã đăng ký thành công. Admin sẽ kích hoạt tài khoản ở phase quản lý nhân viên.",
    registering: "Đang gửi đăng ký",
    currentAccount: "Tài khoản Google đang đăng nhập",
    switchAccount: "Đổi tài khoản Google",
    switchingAccount: "Đang đăng xuất...",
    switchAccountError: "Không thể đổi tài khoản. Vui lòng thử lại."
  }
};
