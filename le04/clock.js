const header2 = document. querySelector(("#clock"))

function updateclock(){

    const curtime = new Date();

    const timestring = String(curtime.getHours()).padStart(2,"0") + ":" + String(curtime.getMinutes()).padStart(2,"0") + ":" + String(curtime.getSeconds()).padStart(2,"0");
    // alert(timestring)
    console.log(timestring)
    header2.innerHTML = timestring


}


updateclock()
setInterval(updateclock, 1000)