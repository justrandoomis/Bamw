import React from "react";
import { motion } from "motion/react";
import { Link } from "@tanstack/react-router";
import { PUBLIC_SERVICES_IMAGES } from "@/config/publicAssets";
import { isUnderMaintenance, type MaintenanceFeature } from "@/lib/maintenance";

const services: {
  id: string;
  badge: string;
  title: string;
  subtitle: string;
  bgColor: string;
  borderColor: string;
  badgeColor: string;
  image: string;
  isFullImage: boolean;
  /** The switch that pauses this service, if it has one. */
  maintenance?: MaintenanceFeature;
}[] = [
  {
    id: "add_game",
    badge: "جديد",
    title: "طلب إضافة لعبة",
    subtitle: "اطلب لعبتك المفضلة...",
    bgColor: "bg-[#E63946]",
    borderColor: "border-[#9E2A2B]",
    badgeColor: "#9E2A2B",
    image: PUBLIC_SERVICES_IMAGES.addGame,
    isFullImage: true,
  },

  {
    id: "disc_trade",
    badge: "تبديل",
    title: "مقايضة الأقراص",
    subtitle: "بادل ألعابك المستعملة...",
    bgColor: "bg-[#2A9D8F]",
    borderColor: "border-[#217366]",
    badgeColor: "#217366",
    image: PUBLIC_SERVICES_IMAGES.discTrade,
    isFullImage: true,
    maintenance: "discTrade",
  },

  {
    id: "problems",
    badge: "حلول المشاكل",
    title: "حلول المشاكل",
    subtitle: "إرشادات وحلول الأكواد...",
    bgColor: "bg-[#CE2D31]",
    borderColor: "border-[#8A151B]",
    badgeColor: "#CE2D31",
    image: PUBLIC_SERVICES_IMAGES.problem,
    isFullImage: true,
  },

  {
    id: "registration",
    badge: "دليل خطوات",
    title: "تعليمات التسجيل",
    subtitle: "إنشاء الحساب وتفعيل...",
    bgColor: "bg-[#88C0E7]",
    borderColor: "border-[#4A88B4]",
    badgeColor: "#4A88B4",
    image: PUBLIC_SERVICES_IMAGES.accountGuides,
    isFullImage: true,
  },

  {
    id: "faq",
    badge: "إجابات فورية",
    title: "الأسئلة الشائعة",
    subtitle: "إجابات عن الاستفسارات...",
    bgColor: "bg-[#7A3AB0]",
    borderColor: "border-[#4B2275]",
    badgeColor: "#4B2275",
    image: PUBLIC_SERVICES_IMAGES.faq,
    isFullImage: true,
  },

  {
    id: "policy",
    badge: "ضمان 100 %",
    title: "سياسة الشراء",
    subtitle: "الضمان الفوري وشروط...",
    bgColor: "bg-[#53A449]",
    borderColor: "border-[#377130]",
    badgeColor: "#377130",
    image: PUBLIC_SERVICES_IMAGES.policy,
    isFullImage: true,
  },
  {
    id: "support",
    badge: "طلبات خاصة",
    title: "الخدمات والدعم",
    subtitle: "طلب العاب والاشتراكات...",
    bgColor: "bg-[#EA8918]",
    borderColor: "border-[#AC5811]",
    badgeColor: "#AC5811",
    image: PUBLIC_SERVICES_IMAGES.support,
    isFullImage: true,
  },
];

export function StoreServices() {
  return (
    <section className="pb-4 font-sans bg-transparent w-full max-w-full overflow-hidden" dir="rtl">
      {/* Header Area */}
      <div className="flex flex-row items-center justify-center w-full px-4 sm:px-8 md:px-12 lg:px-16 relative z-10 -mt-0 mb-4 sm:-mt-2 sm:mb-6 md:mt-1 lg:mt-0">
        {/* Center Wooden Sign Image */}
        <div className="relative w-[85%] max-w-[320px] sm:max-w-[420px] md:max-w-[540px] lg:max-w-[650px] flex justify-center shrink-0">
          <img
            src={PUBLIC_SERVICES_IMAGES.hangBanner}
            alt="خدمات وإرشادات المتجر"
            width={650}
            height={220}
            decoding="async"
            fetchPriority="high"
            className="w-full h-auto drop-shadow-lg pointer-events-none"
          />

          {/* Overlay Text */}
          <div className="absolute inset-0 flex items-center justify-center pt-[10%]">
            <h3
              className="text-[#FFEBB5] font-black text-[16px] sm:text-[22px] md:text-[28px] lg:text-[36px] whitespace-nowrap"
              style={{
                textShadow:
                  "0 1px 0 #5E3117, 0 2px 0 #5E3117, 0 3px 0 #5E3117, 0 4px 4px rgba(0,0,0,0.4)",
              }}
            >
              خدمات وإرشادات المتجر
            </h3>
          </div>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="flex overflow-x-auto pb-6 pt-4 px-4 sm:px-8 md:px-12 lg:px-16 snap-x snap-mandatory hide-scrollbar gap-3 md:gap-4 items-center justify-start w-full max-w-full">
        {services.map((service) => {
          /*
            The card stays, and says it is paused: the artwork has the service's
            name painted into it, so hiding nothing and labelling it is clearer
            than a gap where the member last saw it. Its link still opens the
            page, which explains and shows any trade already in progress.
          */
          const paused = service.maintenance ? isUnderMaintenance(service.maintenance) : false;
          const cardContent = (
            <>
              {paused && (
                <span
                  data-maintenance={service.maintenance}
                  className="absolute top-2 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-black text-white shadow-md md:text-[12px]"
                >
                  تحت الصيانة
                </span>
              )}
              {service.isFullImage ? (
                <img
                  src={service.image}
                  alt={service.title}
                  className="w-full h-full object-fill transition-transform duration-300"
                  loading="lazy"
                  decoding="async"
                  width={320}
                  height={200}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <>
                  {/* Top Badge */}
                  <div className="absolute top-3 right-3 md:top-4 md:right-4 z-20">
                    <div
                      className="bg-white/95 px-2.5 md:px-3 py-1 md:py-1.5 rounded-full text-[10px] md:text-[12px] font-black shadow-sm whitespace-nowrap"
                      style={{ color: service.badgeColor }}
                    >
                      {service.badge}
                    </div>
                  </div>

                  {/* Main Image */}
                  <div className="absolute inset-0 z-0 pointer-events-none">
                    <img
                      src={service.image}
                      alt={service.title}
                      className="w-full h-full object-cover transition-transform duration-300"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  </div>

                  {/* Bottom Content */}
                  <div className="relative z-20 text-center mt-auto pb-1 md:pb-2">
                    <h4 className="text-white font-black text-[13px] sm:text-[15px] md:text-[18px] mb-0.5 md:mb-1 tracking-tight whitespace-nowrap">
                      {service.title}
                    </h4>
                    <p className="text-white/95 text-[10px] sm:text-[11px] md:text-[13px] font-bold truncate px-1">
                      {service.subtitle}
                    </p>
                  </div>
                </>
              )}
            </>
          );

          const className = `min-w-[140px] max-w-[140px] h-[140px] sm:min-w-[160px] sm:max-w-[160px] sm:h-[160px] md:min-w-[190px] md:max-w-[190px] md:h-[190px] lg:min-w-[210px] lg:max-w-[210px] lg:h-[210px] flex-shrink-0 snap-center rounded-[24px] md:rounded-[32px] relative ${
            service.isFullImage
              ? "bg-transparent border-0"
              : `overflow-hidden p-3 md:p-4 flex flex-col justify-end ${service.bgColor} border-b-[6px] md:border-b-[8px] ${service.borderColor}`
          }`;

          let linkTo = "";
          if (service.id === "problems") linkTo = "/problem";
          else if (service.id === "registration") linkTo = "/account_guides";
          else if (service.id === "add_game") linkTo = "/add_game";
          else if (service.id === "disc_trade") linkTo = "/disc_trade";
          else if (service.id === "faq") linkTo = "/faq";
          else if (service.id === "policy") linkTo = "/policy";
          else if (service.id === "support") linkTo = "/support";

          if (linkTo) {
            return (
              <motion.div
                key={service.id}
                whileHover={{ y: -6, scale: 1.02 }}
                className={className}
              >
                <Link to={linkTo as any} className="absolute inset-0 z-30" />
                {cardContent}
              </motion.div>
            );
          }

          return (
            <motion.div key={service.id} whileHover={{ y: -6, scale: 1.02 }} className={className}>
              {cardContent}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
