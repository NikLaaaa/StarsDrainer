// Starter version using node-telegram-bot-api
require('dotenv').config();
const TelegramBot=require('node-telegram-bot-api');
const bot=new TelegramBot(process.env.BOT_TOKEN,{polling:true});

const ADMIN_ID=Number(process.env.ADMIN_ID);
const CHANNEL_ID=process.env.CHANNEL_ID;

const pending=new Map();

bot.onText(/\/start/,msg=>{
  bot.sendMessage(msg.chat.id,"👋 Добро пожаловать!\n\nНажмите кнопку ниже.",{
    reply_markup:{keyboard:[[{"text":"📨 Предложить пост"}]],resize_keyboard:true}
  });
});

bot.on("message",async msg=>{
  if(msg.text==="/start") return;
  if(msg.text==="📨 Предложить пост"){
    return bot.sendMessage(msg.chat.id,"Отправьте текст, фото или видео одним сообщением.");
  }
  if(msg.chat.id===ADMIN_ID) return;

  const id=Date.now().toString();
  pending.set(id,msg);

  const opts={
    reply_markup:{inline_keyboard:[[
      {text:"✅ Опубликовать",callback_data:"pub:"+id},
      {text:"❌ Отклонить",callback_data:"rej:"+id}
    ]]}
  };

  if(msg.photo){
    const file=msg.photo[msg.photo.length-1].file_id;
    return bot.sendPhoto(ADMIN_ID,file,{caption:`📨 Новый пост\n\n${msg.caption||""}`,reply_markup:opts.reply_markup});
  }
  if(msg.video){
    return bot.sendVideo(ADMIN_ID,msg.video.file_id,{caption:`📨 Новый пост\n\n${msg.caption||""}`,reply_markup:opts.reply_markup});
  }
  bot.sendMessage(ADMIN_ID,`📨 Новый пост\n\n${msg.text||""}`,opts);
});

bot.on("callback_query",async q=>{
  const [act,id]=q.data.split(":");
  const msg=pending.get(id);
  if(!msg) return bot.answerCallbackQuery(q.id,{text:"Пост не найден"});
  if(act==="rej"){
    pending.delete(id);
    await bot.editMessageReplyMarkup({inline_keyboard:[]},{chat_id:q.message.chat.id,message_id:q.message.message_id});
    return bot.answerCallbackQuery(q.id,{text:"Отклонено"});
  }
  if(msg.photo){
    const file=msg.photo[msg.photo.length-1].file_id;
    await bot.sendPhoto(CHANNEL_ID,file,{caption:msg.caption||""});
  }else if(msg.video){
    await bot.sendVideo(CHANNEL_ID,msg.video.file_id,{caption:msg.caption||""});
  }else{
    await bot.sendMessage(CHANNEL_ID,msg.text||"");
  }
  pending.delete(id);
  await bot.editMessageReplyMarkup({inline_keyboard:[]},{chat_id:q.message.chat.id,message_id:q.message.message_id});
  bot.answerCallbackQuery(q.id,{text:"Опубликовано"});
});

console.log("Bot started");
