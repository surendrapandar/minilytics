/**
 * A compact land mask of the world, shared by the dither globe and the dot
 * map. Rasterised from Natural Earth's 1:50m land polygons (public domain,
 * naturalearthdata.com) onto a 480 by 240 equirectangular grid, 0.75° per
 * cell, then run-length encoded. No network fetch: the whole mask is this
 * 3.8 KB string.
 */

/** A place on Earth: latitude (north positive), longitude (east positive), in degrees. */
export type LatLon = readonly [lat: number, lon: number];

/** Columns of the mask, from 180°W eastwards. */
export const LAND_COLUMNS = 480;
/** Rows of the mask, from 90°N southwards. */
export const LAND_ROWS = 240;

// Runs alternate ocean, land, ocean… in row-major order. Each character is a
// run length in base 64; "_" adds 63 and continues the same run.
const RUNS =
  "______________________________________________________________________h42C21O11S______J41R56211Z21______CW6s1B_____r731322I4_4_O292i7___ZA1J9ym21C_P9___I3CA3CA_1fC_a72211___428524452G3_6j21622_e7___04U21AB_3k553_g3__s5R36FB_221k2_32i7__n45442521664T28s_j9a23KX1__DF74232GTq11_c5aXW71232__53R21614Vo_b5aX__eBL11146kl_b5X14U21e2_zE846435341CSj_b4I2Cq58__F81D144722551725Rh_b4I531232_1E7_x44I62425MO21f_a5H522281z419E_7411lIB45ON12Z23-131Y4D82B1_01S27qMN2DL75892EHgyBc2981_qnX5C11155J5244749BI22ZvKL1F5562__03B12G_71433A3341335A9J21Wu21SJ221221A26231__FF_45146541927633AGS_0Y534V3__LF_B1YCDDQ_1a422X2__T624_b12D917BPO1cS36221a1__J1A5_i12E933DJKDaD3D7__z648_h147GIGOCXD5D322__yQ_Y36CAIFO9YF4G2__-P_X71H514ID_3F4___KL_YB2H4MB_2F4___11KK_YH127VA_0G6__-2ER_WL9U8_1G6__r523CUH144_5MBX2_2H654__g9732aB32EyNA62_TIC__a1684k218LwLE34_T4388__WO4r4OwLK_D2E247A__UN5r322N21tLK_B5G12621421__SN8o2WzGK_B5E3356__UO9l112Y-DM_B4E2339__TP8_O11_26P_5315D311C__RQ9_R_14T_2443D231431__UQ6_Q12_15U-544A__q21H5_W_13Vz5374__u12H4_Y_03U-3484__u12I2_a_01T21_663__w12I1_a11_R31_626__x23_u21_EC2_D__y32_v31_A2386_7___022_y21_71687_2___421_z_916811213_4___131_-_F_Lq111F4_p42_z_H1112_Fh244E6_o__5_F14_HJ1M433D6_p__6_C23_KI4J615C5_p72_y_A52_LD244HEB5_o85_v_9_JGA45EH96_l86_w_9_JG81246CI96_fG1_z_8_JGD54C557A7_cE1__0_5_NDB16437132R7_bE2_-_4_OCB27244113V5_Q38G2__0_3_OCB282444V5_P3143H2__0_2_PCL1644T7_MA4F3__2z11_PBI3835T7_N95D3__3z_R217E152926U5_S64B4__4y_V18DP1323_o8495__5z_U16FY_n946116__6x_VMT23_m9359__At_WNY_nF7__Fp_WQW_pC221__Kn_WV92H_qC2__Mm_WY66D_rC1__O22g_Xa4A331_t__b23W1116_Xc1__A__c22O2583_W_E3_X__c21NH2_V_F4_V__e22JJ2_Ty1K3_U__e33HK3_Q_03I4_S__g23GL2_Q_03J612_L__i22GL2_P_23IA_J__k14E_l_34J51E_7__k15D_l_43J43E_441__j14C_k_54RD_332__pBJ5_L_74RD_052__pBM4_J_83SCT1T___0AB3B3_G_93RE31J7L22___2B95D3_F_93PJJ7J41_-1_3C84M1_9_94NKIAG52_z1_5B74K4_8_95MKGCG42___6C18D141231121_4_94KMFEF41F1__vH_Y_A4IODFGJ2__wF_X_B5FQCG31DH3__y427_X_B5DSAI22EG3___4C_R_C4CT9NFF2___6C_P_F29X8OEG1___8A_Q_F26Z8OFF111___A6_Q_G13d7O22BF1___D4G1_A_Hg7O23AK1___93F1_D_EA1X5Q149K1___A3B9_8_F46X5P256J121___A3A51812_2_OY4P182N1___D241451E_0_NY321N271N121___C5121L_0_MZ231N2X2___E23P-_Ke3N2T6___IQ-_Je3O1V4___JQ_0I2xg2O3J291___LWwD7w_63H4___UXw4519v_0434F5___UY_Iq_1334E5___VZ_Io_3423D6___Ua_In_5422B8___Tc_Hl_842299___Sd_Hk_A49D314131___De_Gk_B67C7151___Dg_Ej_D58BJ1___6l_Ai_F57A3212B4___4m_Ag_G5215843E342__-o_7f_I75844E236__xt_3d_K581234452313E__tv_3c_L4I212GD__rw_3a_N3I131IC81__hz_0a_O2hB34__iz_1Z_Q3fCA1__ey_0a_Q8ZB__qy_1Z_V5W823__qw_2Y_e32252I443__pw_2Z_h152T3E1__au_3Z_i141W2__ot_4a_____8r_5a_v1E1__-p_6aB1_j872__zo_6bB2_i872__zo_6bA3_h882__-n_5cA3_b42884__zm_5c85_aG75__-k_5b76_bH65___1i_5a77_Y11K36___2h_5Y97_YWg1__Mf_6XA7_YW___2f_7VB6_YX___2f_7UC6_Wb___0e_9SD6_TfL1__fc_ATB6_RjL1__dd_BSB6_Pm__yc_CSB6_Pn__xY_GSB5_Po__xV_JSB5_Pq__vU_LPE3_Rp__vT_MO_jq__uT_MO_ir__tU_MO_jq__tU_NM_kr__sT_PL_lq__sS_RJ_mp__sT_RI_np__sR_UG_po__tQ_UF_qH5S__tP_VE_rDCO__tP_WC_tBF31I__uO_Y5_z6K21J__uJ31___d3P11G__uL____9FV2__OL____AEW1__NM____AEX2__LL____CAa311__IK____H122b5__IF_____04__KF_____13__JC13____O1a122__LB____S5V3__N11B____S3V4__N11B____S2V4__PB____z4__QB____x4__S9____y5__QA____y5__SA_______TB_______QC_______RB__u1____a8_______U8_______W7_______W7_______X214_______X223_______Y6_______Z211___________________________________________________________________________________________Z4_______V4_______Y3_______Z211__O8r15856K613___G113__Q11Bae13111V___A2__LV11F_O___7211__EcB_Z31__q327__236dA_l__f15318_b131Ll7_s__e14418_92CM253u4_u18__U918_341A1_R5__6_v4W538_3_g3__7_s1248112B1527By_l1__811_N313Qsx___r_L1C13732Dqw___q_Dq1ny___q_322_fs____1_5_Uz____6qA2_cq____C41m_Z16c7B____Fg5A_WE3P9D____8_3_YD162CAM___y_5_ZH487J____8x_uW____Jy_uG84____Nu_z6____mW_______DB3H_______m2____________________________________________________r";

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

let decoded: Uint8Array | null = null;

/** The mask as one byte per cell, 1 for land, row-major from the north-west corner. Decoded once. */
export const landMask = (): Uint8Array => {
  if (decoded) {
    return decoded;
  }
  const mask = new Uint8Array(LAND_COLUMNS * LAND_ROWS);
  let at = 0;
  let land = false;
  let run = 0;
  for (const char of RUNS) {
    const value = ALPHABET.indexOf(char);
    run += value;
    if (value === 63) {
      continue;
    }
    if (land) {
      mask.fill(1, at, at + run);
    }
    at += run;
    run = 0;
    land = !land;
  }
  decoded = mask;
  return mask;
};

const wrap = (value: number, size: number) => ((value % size) + size) % size;

/** Whether the mask cell under a latitude and longitude is land. */
export const isLand = (lat: number, lon: number): boolean => {
  const column = wrap(
    Math.floor(((lon + 180) / 360) * LAND_COLUMNS),
    LAND_COLUMNS
  );
  const row = Math.min(
    LAND_ROWS - 1,
    Math.max(0, Math.floor(((90 - lat) / 180) * LAND_ROWS))
  );
  return landMask()[row * LAND_COLUMNS + column] === 1;
};

/**
 * Land coverage around a point, 0 to 1, blended from the four nearest
 * cells. Thresholding it at 0.5 gives smoother coastlines than `isLand`
 * when the mask is drawn larger than its own resolution.
 */
export const landCoverage = (lat: number, lon: number): number => {
  const mask = landMask();
  const x = ((lon + 180) / 360) * LAND_COLUMNS - 0.5;
  const y = Math.min(
    LAND_ROWS - 1,
    Math.max(0, ((90 - lat) / 180) * LAND_ROWS - 0.5)
  );
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const y1 = Math.min(LAND_ROWS - 1, y0 + 1);
  const at = (column: number, row: number) =>
    mask[row * LAND_COLUMNS + wrap(column, LAND_COLUMNS)] ?? 0;
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x0 + 1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
};
