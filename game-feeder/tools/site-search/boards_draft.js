// Draft boards (1 block ≈ 350 m), read by board_check.js
module.exports={
  fanling:{hub:[1,4],headway:[60,10],
    roads:[[1,4,4,4],[2,2,2,6],[2,2,6,2],[6,1,6,2],[4,2,4,6],[2,6,4,6]],
    estates:[{name:'山麗苑',cell:[6,1]},{name:'鳳凰嶺',cell:[3,2]},{name:'北區公園',cell:[2,2]},{name:'華明',cell:[2,6]},{name:'和合石',cell:[3,6]}],
    candidates:[[2,3],[2,2],[3,2],[4,2],[5,2],[6,2],[6,1],[4,3],[4,4],[4,5],[2,5],[2,6],[3,6],[4,6]]},
  // Yuen Long station at the top; the four estates run south along Tai Tong Road / Shap Pat Heung
  // (walks: 大棠路 2.4, 蝶翠峰 4.5, 朗善邨 5.7, 崇山新村 8.6 blocks)
  yuenlong:{hub:[3,0],headway:[60,10],
    roads:[[3,0,3,8],[1,1,3,1],[1,1,1,4],[1,4,3,4],[2,8,3,8]],
    estates:[{name:'崇山新村',cell:[2,8]},{name:'朗善邨',cell:[3,6]},{name:'蝶翠峰',cell:[2,4]},{name:'大棠路',cell:[1,1]}],
    candidates:[[1,1],[2,1],[1,2],[1,3],[1,4],[2,4],[3,2],[3,3],[3,4],[3,5],[3,6],[3,7],[3,8],[2,8]]}
};
